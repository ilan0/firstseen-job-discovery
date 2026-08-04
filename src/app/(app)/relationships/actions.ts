"use server";

import { TZDate } from "@date-fns/tz";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import {
  companies,
  contactCompanyLinks,
  contactInteractions,
  contactMethods,
  contacts,
  organizations,
  referrals,
  referralRequests,
  relationshipReminders,
  searchPreferences,
} from "@/db/schema";
import { refreshCompanyMonitoring } from "@/lib/companies/monitoring";
import { requireOwner } from "@/lib/auth/owner";
import { rolloutFlags } from "@/config/rollout";

function requireRelationshipCrm() {
  if (!rolloutFlags().relationshipCrm) throw new Error("Relationship CRM is not enabled.");
}

const contactSchema = z
  .object({
    companyId: z.string().uuid(),
    name: z.string().trim().min(2).max(160),
    title: z.string().trim().max(160).optional(),
    team: z.string().trim().max(160).optional(),
    location: z.string().trim().max(160).optional(),
    relationshipOrigin: z.string().trim().max(160).optional(),
    relationshipStrength: z.coerce.number().int().min(1).max(5),
    relationshipStatus: z.enum(["current", "past"]),
    methodKind: z.enum(["email", "phone", "profile_url", "other"]).optional(),
    methodValue: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(2_000).optional(),
    canRefer: z.enum(["on"]).optional(),
  })
  .superRefine((input, context) => {
    if (input.methodValue && !input.methodKind)
      context.addIssue({ code: "custom", path: ["methodKind"], message: "Choose a method." });
    if (input.methodKind === "email" && input.methodValue) {
      const result = z.email().safeParse(input.methodValue);
      if (!result.success)
        context.addIssue({ code: "custom", path: ["methodValue"], message: "Invalid email." });
    }
    if (input.methodKind === "profile_url" && input.methodValue) {
      const result = z.url({ protocol: /^https$/ }).safeParse(input.methodValue);
      if (!result.success)
        context.addIssue({ code: "custom", path: ["methodValue"], message: "Use HTTPS." });
    }
  });

async function ownedCompany(ownerId: string, companyId: string) {
  const [company] = await db
    .select({
      id: companies.id,
      organizationId: companies.organizationId,
      name: companies.name,
      normalizedName: companies.normalizedName,
    })
    .from(companies)
    .where(and(eq(companies.userId, ownerId), eq(companies.id, companyId)))
    .limit(1);
  if (!company) throw new Error("Company not found.");
  if (company.organizationId) return { id: company.id, organizationId: company.organizationId };
  return db.transaction(async (tx) => {
    const [knownOrganization] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.normalizedName, company.normalizedName))
      .limit(1);
    const [organization] = knownOrganization
      ? [knownOrganization]
      : await tx
          .insert(organizations)
          .values({ name: company.name, normalizedName: company.normalizedName })
          .returning({ id: organizations.id });
    if (!organization) throw new Error("Company organization could not be created.");
    await tx
      .update(companies)
      .set({ organizationId: organization.id, updatedAt: new Date() })
      .where(and(eq(companies.userId, ownerId), eq(companies.id, company.id)));
    return { id: company.id, organizationId: organization.id };
  });
}

async function ownedContact(ownerId: string, contactId: string) {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.userId, ownerId), eq(contacts.id, contactId)))
    .limit(1);
  if (!contact) throw new Error("Contact not found.");
  return contact;
}

export type ContactFormState = { error?: string; success?: string };

export async function createContact(
  _state: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  requireRelationshipCrm();
  const owner = await requireOwner();
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Check the contact details." };
  const input = parsed.data;
  const company = await ownedCompany(owner.id, input.companyId);
  const result = await db.transaction(async (tx) => {
    let legacyReferralId: string | null = null;
    if (input.canRefer) {
      const [legacy] = await tx
        .insert(referrals)
        .values({
          userId: owner.id,
          companyId: company.id,
          personName: input.name,
          personTitle: input.title || null,
          relationship: input.relationshipOrigin || null,
          status: "available",
          notes: input.notes || null,
        })
        .returning({ id: referrals.id });
      legacyReferralId = legacy?.id ?? null;
    }
    const [contact] = await tx
      .insert(contacts)
      .values({
        userId: owner.id,
        name: input.name,
        title: input.title || null,
        team: input.team || null,
        location: input.location || null,
        relationshipOrigin: input.relationshipOrigin || null,
        relationshipStrength: input.relationshipStrength,
        notes: input.notes || null,
        legacyReferralId,
      })
      .returning({ id: contacts.id });
    if (!contact) throw new Error("Contact could not be saved.");
    await tx.insert(contactCompanyLinks).values({
      userId: owner.id,
      contactId: contact.id,
      organizationId: company.organizationId,
      relationshipStatus: input.relationshipStatus,
    });
    if (input.methodKind && input.methodValue)
      await tx.insert(contactMethods).values({
        userId: owner.id,
        contactId: contact.id,
        kind: input.methodKind,
        value: input.methodValue,
        primary: true,
      });
    if (input.canRefer)
      await tx.insert(referralRequests).values({
        userId: owner.id,
        contactId: contact.id,
        organizationId: company.organizationId,
        status: "available",
        notes: input.notes || null,
      });
    return contact.id;
  });
  await refreshCompanyMonitoring(owner.id, company.id);
  revalidatePath("/relationships");
  revalidatePath("/watchlist");
  return { success: `${input.name} was added.`, contactId: result } as ContactFormState;
}

const interactionSchema = z.object({
  contactId: z.string().uuid(),
  interactionType: z.string().trim().min(2).max(80),
  summary: z.string().trim().min(2).max(2_000),
  outcome: z.string().trim().max(500).optional(),
});

export async function addContactInteraction(formData: FormData) {
  requireRelationshipCrm();
  const owner = await requireOwner();
  const input = interactionSchema.parse(Object.fromEntries(formData));
  await ownedContact(owner.id, input.contactId);
  await db.insert(contactInteractions).values({
    userId: owner.id,
    contactId: input.contactId,
    occurredAt: new Date(),
    interactionType: input.interactionType,
    summary: input.summary,
    outcome: input.outcome || null,
  });
  revalidatePath("/relationships");
}

const reminderSchema = z.object({
  contactId: z.string().uuid(),
  dueDate: z.iso.date(),
  nextAction: z.string().trim().min(2).max(500),
});

export async function addRelationshipReminder(formData: FormData) {
  requireRelationshipCrm();
  const owner = await requireOwner();
  const input = reminderSchema.parse(Object.fromEntries(formData));
  await ownedContact(owner.id, input.contactId);
  const [preferences] = await db
    .select({ timezone: searchPreferences.timezone })
    .from(searchPreferences)
    .where(eq(searchPreferences.userId, owner.id))
    .limit(1);
  const [year, month, day] = input.dueDate.split("-").map(Number);
  const dueAt = new TZDate(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
    9,
    0,
    preferences?.timezone ?? "America/New_York",
  );
  await db.insert(relationshipReminders).values({
    userId: owner.id,
    contactId: input.contactId,
    dueAt,
    nextAction: input.nextAction,
  });
  revalidatePath("/relationships");
}

const idSchema = z.string().uuid();

export async function completeRelationshipReminder(formData: FormData) {
  requireRelationshipCrm();
  const owner = await requireOwner();
  const id = idSchema.parse(formData.get("reminderId"));
  await db
    .update(relationshipReminders)
    .set({ completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(relationshipReminders.userId, owner.id), eq(relationshipReminders.id, id)));
  revalidatePath("/relationships");
}

const referralStatusSchema = z.object({
  requestId: z.string().uuid(),
  status: z.enum([
    "available",
    "requested",
    "agreed",
    "submitted",
    "declined",
    "expired",
    "completed",
  ]),
});

export async function updateReferralStatus(formData: FormData) {
  requireRelationshipCrm();
  const owner = await requireOwner();
  const input = referralStatusSchema.parse(Object.fromEntries(formData));
  const now = new Date();
  const [request] = await db
    .update(referralRequests)
    .set({
      status: input.status,
      requestedAt: input.status === "requested" ? now : undefined,
      respondedAt: input.status === "agreed" || input.status === "declined" ? now : undefined,
      submittedAt: input.status === "submitted" ? now : undefined,
      completedAt: input.status === "completed" ? now : undefined,
      updatedAt: now,
    })
    .where(and(eq(referralRequests.userId, owner.id), eq(referralRequests.id, input.requestId)))
    .returning({ contactId: referralRequests.contactId });
  if (!request) throw new Error("Referral request not found.");
  const contact = await ownedContact(owner.id, request.contactId);
  if (contact.legacyReferralId)
    await db
      .update(referrals)
      .set({ status: input.status, updatedAt: now })
      .where(and(eq(referrals.userId, owner.id), eq(referrals.id, contact.legacyReferralId)));
  revalidatePath("/relationships");
  revalidatePath("/watchlist");
}

export async function archiveContact(formData: FormData) {
  requireRelationshipCrm();
  const owner = await requireOwner();
  const id = idSchema.parse(formData.get("contactId"));
  await db
    .update(contacts)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(contacts.userId, owner.id), eq(contacts.id, id)));
  revalidatePath("/relationships");
}
