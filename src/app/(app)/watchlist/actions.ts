"use server";

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { connectorVersions } from "@/connectors/versions";
import { rolloutFlags } from "@/config/rollout";
import { db } from "@/db/client";
import {
  careerSources,
  companies,
  connectorRegistrations,
  globalCareerSources,
  globalScanSchedules,
  globalSourcePolicies,
  organizationDomains,
  organizations,
  referrals,
  sourcePolicyReviews,
  userCompanyFollows,
  watchlists,
} from "@/db/schema";
import { resolveOfficialSource } from "@/discovery/resolve-official";
import { refreshCompanyMonitoring } from "@/lib/companies/monitoring";
import { requireOwner } from "@/lib/auth/owner";
import { refreshGlobalSourceDemand } from "@/lib/supply/demand";
import { inngest } from "@/inngest/client";

const addSchema = z.object({
  company: z.string().trim().min(2).max(160),
  careerUrl: z.string().url().max(2_000),
  referralPerson: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(2_000).optional(),
  priority: z.coerce.number().int().min(1).max(5),
  interested: z.enum(["on"]).optional(),
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
        "This URL is not a recognized official ATS or careers page. Use an official ATS, reviewed job feed/sitemap, or structured employer careers URL.",
    };
  const publicConfig =
    resolved.kind === "custom_feed"
      ? { reviewed: true }
      : resolved.kind === "custom_sitemap"
        ? {
            reviewed: true,
            jobUrlPattern: "(?:jobs|careers|positions|openings)",
            maximumJobUrls: 100,
            expectedOrganization: input.company,
            requireHiringOrganization: true,
          }
        : resolved.kind === "custom_jsonld"
          ? { expectedOrganization: input.company, requireHiringOrganization: true }
          : {};
  const source = await db.transaction(async (tx) => {
    const now = new Date();
    const sourceIdentity = `${resolved.kind}:${resolved.tenantId ?? resolved.officialUrl}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sourceIdentity}))`);
    const [existingGlobalSource] = await tx
      .select({
        id: globalCareerSources.id,
        organizationId: globalCareerSources.organizationId,
        active: globalCareerSources.active,
      })
      .from(globalCareerSources)
      .where(
        or(
          eq(globalCareerSources.normalizedUrl, resolved.officialUrl),
          and(
            eq(globalCareerSources.connectorKind, resolved.kind),
            resolved.tenantId
              ? eq(globalCareerSources.tenantId, resolved.tenantId)
              : eq(globalCareerSources.normalizedUrl, resolved.officialUrl),
          ),
        ),
      )
      .limit(1);
    if (existingGlobalSource && !existingGlobalSource.active)
      throw new Error("This career source is quarantined and cannot be monitored.");
    const canonicalDomain = resolved.kind.startsWith("custom_")
      ? url.hostname.toLowerCase().replace(/^www\./, "")
      : null;
    if (canonicalDomain)
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`organization:${canonicalDomain}`}))`,
      );
    const [knownDomainOrganization] =
      !existingGlobalSource && canonicalDomain
        ? await tx
            .select({ id: organizations.id })
            .from(organizationDomains)
            .innerJoin(organizations, eq(organizationDomains.organizationId, organizations.id))
            .where(eq(organizationDomains.domain, canonicalDomain))
            .limit(1)
        : [];
    const [organization] = existingGlobalSource
      ? [{ id: existingGlobalSource.organizationId }]
      : knownDomainOrganization
        ? [knownDomainOrganization]
        : await tx
            .insert(organizations)
            .values({
              name: input.company,
              normalizedName: normalizedName(input.company),
              canonicalDomain,
            })
            .returning({ id: organizations.id });
    if (!organization) throw new Error("Organization could not be saved");
    const organizationId = organization.id;
    if (!existingGlobalSource && canonicalDomain)
      await tx
        .insert(organizationDomains)
        .values({
          organizationId,
          domain: canonicalDomain,
          authorityConfidence: 70,
          verifiedAt: now,
          evidence: { source: "owner_submitted_official_url" },
        })
        .onConflictDoNothing();
    const [globalSource] = existingGlobalSource
      ? [existingGlobalSource]
      : await tx
          .insert(globalCareerSources)
          .values({
            organizationId,
            connectorKind: resolved.kind,
            tenantId: resolved.tenantId,
            baseUrl: resolved.officialUrl,
            normalizedUrl: resolved.officialUrl,
            publicConfig,
            parsingConfidence: resolved.kind.startsWith("custom_") ? 55 : 90,
          })
          .returning({
            id: globalCareerSources.id,
            organizationId: globalCareerSources.organizationId,
            active: globalCareerSources.active,
          });
    if (!globalSource) throw new Error("Global career source could not be saved");
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`company:${owner.id}:${organizationId}`}))`,
    );
    const normalizedCompanyName = normalizedName(input.company);
    const [existingCompany] = await tx
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.userId, owner.id),
          or(
            eq(companies.organizationId, organizationId),
            and(
              isNull(companies.organizationId),
              eq(companies.normalizedName, normalizedCompanyName),
            ),
          ),
        ),
      )
      .limit(1);
    const [company] = existingCompany
      ? await tx
          .update(companies)
          .set({
            organizationId,
            name: input.company,
            domain: existingCompany.domain ?? canonicalDomain,
            origin: sql`case when ${companies.origin} = 'discovered' then ${companies.origin} else ${input.referralPerson ? "referral" : "manual"}::company_origin end`,
            priority: input.priority,
            interested: Boolean(input.interested),
            notes: input.notes || null,
            active: true,
            updatedAt: now,
          })
          .where(eq(companies.id, existingCompany.id))
          .returning()
      : await tx
          .insert(companies)
          .values({
            userId: owner.id,
            organizationId,
            name: input.company,
            normalizedName: normalizedCompanyName,
            domain: canonicalDomain,
            origin: input.referralPerson ? "referral" : "manual",
            priority: input.priority,
            interested: Boolean(input.interested),
            notes: input.notes || null,
          })
          .returning();
    if (!company) throw new Error("Company could not be saved");
    await tx
      .insert(globalSourcePolicies)
      .values({
        careerSourceId: globalSource.id,
        provider: resolved.kind,
        policyVersion: "2026-08-04.1",
        status: resolved.kind.startsWith("custom_")
          ? "conditional_reviewed_source"
          : "approved_official_public_source",
        mayRequest: true,
        mayUseTransiently: true,
        mayPersist: true,
        mayDisplay: true,
        mayResolveRedirects: false,
        expectedOrganization: input.company,
        closureMethod:
          resolved.kind === "custom_jsonld"
            ? "reviewed_page_verification"
            : resolved.kind === "custom_sitemap"
              ? "complete_sitemap_with_leaf_jsonld_verification"
              : resolved.kind === "custom_feed"
                ? "complete_reviewed_structured_feed"
                : "complete_official_feed",
        reviewedBy: "owner-server-action",
        activatedAt: new Date(),
      })
      .onConflictDoNothing();
    const [source] = await tx
      .insert(careerSources)
      .values({
        userId: owner.id,
        companyId: company.id,
        connectorKind: resolved.kind,
        baseUrl: resolved.officialUrl,
        normalizedUrl: resolved.officialUrl,
        publicConfig,
        parsingConfidence: resolved.kind.startsWith("custom_") ? 55 : 90,
        globalSourceId: globalSource.id,
      })
      .onConflictDoUpdate({
        target: [careerSources.userId, careerSources.normalizedUrl],
        set: { active: true, globalSourceId: globalSource.id, updatedAt: new Date() },
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
        scope: "personal",
        monitoringTier: input.interested || input.referralPerson ? "priority" : "standard",
        cadenceMinutes: input.interested || input.referralPerson ? 15 : 60,
      })
      .onConflictDoUpdate({
        target: [watchlists.userId, watchlists.companyId],
        set: {
          active: true,
          scope: "personal",
          monitoringTier: input.interested || input.referralPerson ? "priority" : "standard",
          cadenceMinutes: input.interested || input.referralPerson ? 15 : 60,
          nextScanAt: new Date(),
          updatedAt: new Date(),
        },
      });
    await tx
      .insert(globalScanSchedules)
      .values({
        careerSourceId: globalSource.id,
        monitoringTier: input.interested || input.referralPerson ? "priority" : "standard",
        cadenceMinutes: input.interested || input.referralPerson ? 15 : 60,
        nextRunAt: new Date(),
      })
      .onConflictDoUpdate({
        target: globalScanSchedules.careerSourceId,
        set: {
          monitoringTier: input.interested || input.referralPerson ? "priority" : "standard",
          cadenceMinutes: input.interested || input.referralPerson ? 15 : 60,
          nextRunAt: new Date(),
          updatedAt: new Date(),
        },
      });
    await tx
      .insert(userCompanyFollows)
      .values({
        userId: owner.id,
        organizationId,
        interested: Boolean(input.interested),
        scope: "personal",
        active: true,
        stickyDismissed: false,
        notes: input.notes || null,
      })
      .onConflictDoUpdate({
        target: [userCompanyFollows.userId, userCompanyFollows.organizationId],
        set: {
          interested: Boolean(input.interested),
          scope: "personal",
          active: true,
          stickyDismissed: false,
          notes: input.notes || null,
          updatedAt: new Date(),
        },
      });
    await tx
      .insert(sourcePolicyReviews)
      .values({
        userId: owner.id,
        careerSourceId: source.id,
        hostname: url.hostname.toLowerCase(),
        status: resolved.kind.startsWith("custom_") ? "conditional" : "approved",
        rationale: resolved.kind.startsWith("custom_")
          ? "Owner-reviewed public structured source only; no generic HTML scraping."
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
    return { id: source.id, globalSourceId: globalSource.id };
  });
  await refreshGlobalSourceDemand([source.globalSourceId]);
  if (!rolloutFlags().globalSupply)
    try {
      await inngest.send({
        name: "firstseen/source.scan.requested",
        data: { userId: owner.id, sourceId: source.id, scheduledFor: new Date().toISOString() },
      });
    } catch {
      // The due watchlist remains durable and the legacy scheduler will dispatch it.
    }
  revalidatePath("/watchlist");
  return { success: `${input.company} is now monitored.` };
}

const idSchema = z.string().uuid();

async function ownedCompanyId(formData: FormData, ownerId: string) {
  const companyId = idSchema.parse(formData.get("companyId"));
  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.userId, ownerId), eq(companies.id, companyId)))
    .limit(1);
  if (!company) throw new Error("Company not found");
  return companyId;
}

export async function followDiscoveredCompany(formData: FormData) {
  const owner = await requireOwner();
  const companyId = await ownedCompanyId(formData, owner.id);
  const now = new Date();
  await db
    .update(watchlists)
    .set({ active: true, scope: "personal", nextScanAt: now, updatedAt: now })
    .where(and(eq(watchlists.userId, owner.id), eq(watchlists.companyId, companyId)));
  await refreshCompanyMonitoring(owner.id, companyId, now);
  revalidatePath("/watchlist");
}

export async function toggleCompanyInterest(formData: FormData) {
  const owner = await requireOwner();
  const companyId = await ownedCompanyId(formData, owner.id);
  const interested = formData.get("interested") === "true";
  await db
    .update(companies)
    .set({ interested, updatedAt: new Date() })
    .where(and(eq(companies.userId, owner.id), eq(companies.id, companyId)));
  await refreshCompanyMonitoring(owner.id, companyId);
  revalidatePath("/watchlist");
}

const referralSchema = z.object({
  companyId: z.string().uuid(),
  personName: z.string().trim().min(2).max(160),
});

export async function addCompanyReferral(formData: FormData) {
  const owner = await requireOwner();
  const input = referralSchema.parse(Object.fromEntries(formData));
  await ownedCompanyId(formData, owner.id);
  const [existing] = await db
    .select({ id: referrals.id })
    .from(referrals)
    .where(
      and(
        eq(referrals.userId, owner.id),
        eq(referrals.companyId, input.companyId),
        sql`lower(${referrals.personName}) = lower(${input.personName})`,
      ),
    )
    .limit(1);
  if (!existing)
    await db.insert(referrals).values({
      userId: owner.id,
      companyId: input.companyId,
      personName: input.personName,
      status: "available",
    });
  await refreshCompanyMonitoring(owner.id, input.companyId);
  revalidatePath("/watchlist");
}

export async function removeCompanyReferral(formData: FormData) {
  const owner = await requireOwner();
  const referralId = idSchema.parse(formData.get("referralId"));
  const [removed] = await db
    .delete(referrals)
    .where(and(eq(referrals.userId, owner.id), eq(referrals.id, referralId)))
    .returning({ companyId: referrals.companyId });
  if (removed) await refreshCompanyMonitoring(owner.id, removed.companyId);
  revalidatePath("/watchlist");
}

export async function removeWatchCompany(formData: FormData) {
  const owner = await requireOwner();
  const companyId = await ownedCompanyId(formData, owner.id);
  const globalSourceIds = await db.transaction(async (tx) => {
    const linkedSources = await tx
      .select({ id: careerSources.globalSourceId })
      .from(careerSources)
      .where(and(eq(careerSources.userId, owner.id), eq(careerSources.companyId, companyId)));
    await tx
      .update(watchlists)
      .set({ active: false, monitoringTier: "quarantined", updatedAt: new Date() })
      .where(and(eq(watchlists.userId, owner.id), eq(watchlists.companyId, companyId)));
    await tx
      .update(companies)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(companies.userId, owner.id), eq(companies.id, companyId)));
    await tx
      .update(careerSources)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(careerSources.userId, owner.id), eq(careerSources.companyId, companyId)));
    return linkedSources.flatMap((source) => (source.id ? [source.id] : []));
  });
  await refreshGlobalSourceDemand(globalSourceIds);
  revalidatePath("/watchlist");
}
