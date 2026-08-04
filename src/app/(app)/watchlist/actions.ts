"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { connectorVersions } from "@/connectors/versions";
import { db } from "@/db/client";
import {
  careerSources,
  companies,
  connectorRegistrations,
  referrals,
  sourcePolicyReviews,
  watchlists,
} from "@/db/schema";
import { resolveOfficialSource } from "@/discovery/resolve-official";
import { requireOwner } from "@/lib/auth/owner";
import { inngest } from "@/inngest/client";

const addSchema = z.object({
  company: z.string().trim().min(2).max(160),
  careerUrl: z.string().url().max(2_000),
  referralPerson: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(2_000).optional(),
  priority: z.coerce.number().int().min(1).max(5),
});

function normalizedName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type WatchlistFormState = { error?: string; success?: string };

export async function addWatchCompany(
  _state: WatchlistFormState,
  formData: FormData,
): Promise<WatchlistFormState> {
  const owner = await requireOwner();
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the company name and official careers URL." };
  const input = parsed.data;
  const url = new URL(input.careerUrl);
  if (url.protocol !== "https:" || url.username || url.password)
    return { error: "The careers URL must be a safe HTTPS URL." };
  const resolved = resolveOfficialSource(url.toString());
  if (!resolved)
    return {
      error:
        "This URL is not a recognized official ATS or careers page. Use an official Greenhouse, Lever, Ashby, or structured employer careers URL.",
    };
  const sourceId = await db.transaction(async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({
        userId: owner.id,
        name: input.company,
        normalizedName: normalizedName(input.company),
        origin: input.referralPerson ? "referral" : "manual",
        priority: input.priority,
        notes: input.notes || null,
      })
      .onConflictDoUpdate({
        target: [companies.userId, companies.normalizedName],
        set: {
          name: input.company,
          origin: input.referralPerson ? "referral" : "manual",
          priority: input.priority,
          notes: input.notes || null,
          active: true,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!company) throw new Error("Company could not be saved");
    const [source] = await tx
      .insert(careerSources)
      .values({
        userId: owner.id,
        companyId: company.id,
        connectorKind: resolved.kind,
        baseUrl: resolved.officialUrl,
        normalizedUrl: resolved.officialUrl,
        publicConfig: {},
        parsingConfidence: resolved.kind === "custom_jsonld" ? 55 : 90,
      })
      .onConflictDoUpdate({
        target: [careerSources.userId, careerSources.normalizedUrl],
        set: { active: true, updatedAt: new Date() },
      })
      .returning();
    if (!source) throw new Error("Career source could not be saved");
    await tx
      .update(careerSources)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(eq(careerSources.companyId, company.id), sql`${careerSources.id} <> ${source.id}`),
      );
    await tx
      .insert(connectorRegistrations)
      .values({
        userId: owner.id,
        careerSourceId: source.id,
        externalTenantId: resolved.tenantId,
        connectorVersion: connectorVersions[resolved.kind],
      })
      .onConflictDoUpdate({
        target: connectorRegistrations.careerSourceId,
        set: {
          externalTenantId: resolved.tenantId,
          connectorVersion: connectorVersions[resolved.kind],
          updatedAt: new Date(),
        },
      });
    await tx
      .insert(watchlists)
      .values({
        userId: owner.id,
        companyId: company.id,
        cadenceMinutes: input.priority <= 2 ? 60 : 120,
      })
      .onConflictDoUpdate({
        target: [watchlists.userId, watchlists.companyId],
        set: {
          active: true,
          cadenceMinutes: input.priority <= 2 ? 60 : 120,
          nextScanAt: new Date(),
          updatedAt: new Date(),
        },
      });
    await tx
      .insert(sourcePolicyReviews)
      .values({
        userId: owner.id,
        careerSourceId: source.id,
        hostname: url.hostname.toLowerCase(),
        status: resolved.kind === "custom_jsonld" ? "conditional" : "approved",
        rationale:
          resolved.kind === "custom_jsonld"
            ? "Public JSON-LD only; no generic HTML scraping."
            : "Official public ATS endpoint.",
      })
      .onConflictDoUpdate({
        target: [sourcePolicyReviews.userId, sourcePolicyReviews.hostname],
        set: { careerSourceId: source.id, reviewedAt: new Date(), updatedAt: new Date() },
      });
    if (input.referralPerson) {
      const [existingReferral] = await tx
        .select({ id: referrals.id })
        .from(referrals)
        .where(
          and(
            eq(referrals.userId, owner.id),
            eq(referrals.companyId, company.id),
            sql`lower(${referrals.personName}) = lower(${input.referralPerson})`,
          ),
        )
        .limit(1);
      if (existingReferral)
        await tx
          .update(referrals)
          .set({ notes: input.notes || null, updatedAt: new Date() })
          .where(eq(referrals.id, existingReferral.id));
      else
        await tx.insert(referrals).values({
          userId: owner.id,
          companyId: company.id,
          personName: input.referralPerson,
          notes: input.notes || null,
        });
    }
    return source.id;
  });
  try {
    await inngest.send({
      name: "firstseen/source.scan.requested",
      data: { userId: owner.id, sourceId, scheduledFor: new Date().toISOString() },
    });
  } catch {
    // The due watchlist remains durable and the scheduler will dispatch it within 15 minutes.
  }
  revalidatePath("/watchlist");
  return { success: `${input.company} is now monitored.` };
}

const idSchema = z.string().uuid();
export async function removeWatchCompany(formData: FormData) {
  const owner = await requireOwner();
  const companyId = idSchema.parse(formData.get("companyId"));
  await db.transaction(async (tx) => {
    await tx
      .update(watchlists)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(watchlists.userId, owner.id), eq(watchlists.companyId, companyId)));
    await tx
      .update(companies)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(companies.userId, owner.id), eq(companies.id, companyId)));
    await tx
      .update(careerSources)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(careerSources.userId, owner.id), eq(careerSources.companyId, companyId)));
  });
  revalidatePath("/watchlist");
}
