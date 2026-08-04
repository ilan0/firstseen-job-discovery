import "server-only";

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { connectorVersions } from "@/connectors/versions";
import { db } from "@/db/client";
import {
  careerSources,
  companies,
  connectorRegistrations,
  globalCareerSources,
  globalScanSchedules,
  organizations,
  sourcePolicyReviews,
  userCompanyFollows,
  watchlists,
} from "@/db/schema";

export async function attachGlobalSourceToUser(
  userId: string,
  globalSourceId: string,
  now = new Date(),
) {
  const [globalSource] = await db
    .select({
      id: globalCareerSources.id,
      organizationId: globalCareerSources.organizationId,
      connectorKind: globalCareerSources.connectorKind,
      tenantId: globalCareerSources.tenantId,
      baseUrl: globalCareerSources.baseUrl,
      normalizedUrl: globalCareerSources.normalizedUrl,
      publicConfig: globalCareerSources.publicConfig,
      parsingConfidence: globalCareerSources.parsingConfidence,
      organizationName: organizations.name,
      normalizedOrganizationName: organizations.normalizedName,
      organizationDomain: organizations.canonicalDomain,
    })
    .from(globalCareerSources)
    .innerJoin(organizations, eq(globalCareerSources.organizationId, organizations.id))
    .where(
      and(
        eq(globalCareerSources.id, globalSourceId),
        eq(globalCareerSources.active, true),
        eq(organizations.active, true),
      ),
    )
    .limit(1);
  if (!globalSource) return null;

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`company:${userId}:${globalSource.organizationId}`}))`,
    );
    const [existingCompany] = await tx
      .select({
        id: companies.id,
        active: companies.active,
        organizationId: companies.organizationId,
      })
      .from(companies)
      .where(
        and(
          eq(companies.userId, userId),
          or(
            eq(companies.organizationId, globalSource.organizationId),
            and(
              isNull(companies.organizationId),
              eq(companies.normalizedName, globalSource.normalizedOrganizationName),
            ),
          ),
        ),
      )
      .limit(1);
    const [company] = existingCompany
      ? await tx
          .update(companies)
          .set({
            organizationId: globalSource.organizationId,
            domain: sql`coalesce(${companies.domain}, ${globalSource.organizationDomain})`,
            updatedAt: now,
          })
          .where(eq(companies.id, existingCompany.id))
          .returning({ id: companies.id, active: companies.active })
      : await tx
          .insert(companies)
          .values({
            userId,
            organizationId: globalSource.organizationId,
            name: globalSource.organizationName,
            normalizedName: globalSource.normalizedOrganizationName,
            domain: globalSource.organizationDomain,
            origin: "discovered",
            priority: 4,
            provisional: false,
            discoveryEvidence: {
              origin: "global_verified_supply",
              discoveredAt: now.toISOString(),
            },
          })
          .returning({ id: companies.id, active: companies.active });
    if (!company?.active) return null;

    const [source] = await tx
      .insert(careerSources)
      .values({
        userId,
        companyId: company.id,
        connectorKind: globalSource.connectorKind,
        baseUrl: globalSource.baseUrl,
        normalizedUrl: globalSource.normalizedUrl,
        publicConfig: globalSource.publicConfig,
        parsingConfidence: globalSource.parsingConfidence,
        globalSourceId: globalSource.id,
      })
      .onConflictDoUpdate({
        target: [careerSources.userId, careerSources.normalizedUrl],
        set: { globalSourceId: globalSource.id, updatedAt: now },
      })
      .returning({ id: careerSources.id, active: careerSources.active });
    if (!source?.active) return null;

    await tx
      .insert(connectorRegistrations)
      .values({
        userId,
        careerSourceId: source.id,
        externalTenantId: globalSource.tenantId,
        connectorVersion: connectorVersions[globalSource.connectorKind],
      })
      .onConflictDoUpdate({
        target: connectorRegistrations.careerSourceId,
        set: {
          externalTenantId: globalSource.tenantId,
          connectorVersion: connectorVersions[globalSource.connectorKind],
          updatedAt: now,
        },
      });
    await tx
      .insert(sourcePolicyReviews)
      .values({
        userId,
        careerSourceId: source.id,
        hostname: new URL(globalSource.baseUrl).hostname,
        status: "approved",
        rationale: "Independently verified official source attached from shared global supply.",
        reviewedAt: now,
      })
      .onConflictDoNothing();
    await tx
      .insert(watchlists)
      .values({
        userId,
        companyId: company.id,
        scope: "discovered",
        monitoringTier: "cold",
        cadenceMinutes: 240,
        nextScanAt: now,
      })
      .onConflictDoNothing();
    await tx
      .insert(userCompanyFollows)
      .values({
        userId,
        organizationId: globalSource.organizationId,
        interested: false,
        scope: "discovered",
        active: true,
        stickyDismissed: false,
      })
      .onConflictDoNothing();
    await tx
      .update(globalScanSchedules)
      .set({
        nextRunAt: sql`least(${globalScanSchedules.nextRunAt}, ${now.toISOString()}::timestamptz)`,
        updatedAt: now,
      })
      .where(eq(globalScanSchedules.careerSourceId, globalSource.id));
    return { companyId: company.id, sourceId: source.id, globalSourceId: globalSource.id };
  });
}

export async function attachGlobalSourcesToUser(
  userId: string,
  globalSourceIds: string[],
  now = new Date(),
) {
  const attached = [];
  for (const sourceId of [...new Set(globalSourceIds)]) {
    const result = await attachGlobalSourceToUser(userId, sourceId, now);
    if (result) attached.push(result);
  }
  return attached;
}
