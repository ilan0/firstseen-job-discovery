import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { connectorVersions } from "@/connectors/versions";
import { db } from "@/db/client";
import {
  careerSources,
  companies,
  connectorRegistrations,
  globalCareerSources,
  globalScanRuns,
  globalScanSchedules,
  globalSourcePolicies,
  organizations,
  sourcePolicyReviews,
  usageCostLedger,
  userCompanyFollows,
  watchlists,
} from "@/db/schema";
import { buildDiscoveryQueries } from "@/discovery/queries";
import { activeDiscoveryProviders, providerRights } from "@/discovery/provider-policy";
import { resolveSafeRedirect } from "@/discovery/redirect-resolver";
import { resolveOfficialSource } from "@/discovery/resolve-official";
import { verifyStructuredJobAuthority } from "@/discovery/structured-authority";
import { verifyCompanyAuthority } from "@/discovery/company-authority";
import { AdzunaSensor } from "@/discovery/sensors/adzuna";
import { BraveSensor } from "@/discovery/sensors/brave";
import type { DiscoveryCandidate } from "@/discovery/types";
import { serverEnv } from "@/lib/env/server";
import { supplyCapacityState } from "@/lib/load/capacity";

const MONTHLY_SENSOR_REQUEST_LIMIT = 900;

async function mayAdmitColdSource() {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [tiers, used] = await Promise.all([
    db
      .select({ tier: globalScanSchedules.monitoringTier, count: sql<string>`count(*)` })
      .from(globalScanSchedules)
      .where(eq(globalScanSchedules.active, true))
      .groupBy(globalScanSchedules.monitoringTier),
    db
      .select({ count: sql<string>`count(*)` })
      .from(globalScanRuns)
      .where(gte(globalScanRuns.createdAt, monthStart)),
  ]);
  const count = (tier: string) => Number(tiers.find((entry) => entry.tier === tier)?.count ?? 0);
  return supplyCapacityState({
    prioritySources: count("priority"),
    standardSources: count("standard") + count("warm"),
    coldSources: count("cold") + 1,
    monthlyExecutionLimit: serverEnv().INNGEST_MONTHLY_EXECUTION_LIMIT,
    usedExecutionsThisMonth: Number(used[0]?.count ?? 0) * 3,
  }).admitColdSources;
}

async function sensorRequestAllowed(userId: string, provider: "brave" | "adzuna") {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [usage] = await db
    .select({ requests: sql<string>`coalesce(sum(${usageCostLedger.units}), 0)` })
    .from(usageCostLedger)
    .where(
      and(
        eq(usageCostLedger.userId, userId),
        eq(usageCostLedger.provider, provider),
        gte(usageCostLedger.occurredAt, monthStart),
      ),
    );
  return Number(usage?.requests ?? 0) < MONTHLY_SENSOR_REQUEST_LIMIT;
}

function sensorRequestKey(options: {
  provider: "brave" | "adzuna";
  rotation: number;
  query: unknown;
}) {
  const queryHash = createHash("sha256").update(JSON.stringify(options.query)).digest("hex");
  return `sensor:${options.provider}:${options.rotation}:${queryHash}`;
}

async function claimSensorRequest(options: {
  userId: string;
  provider: "brave" | "adzuna";
  rotation: number;
  query: unknown;
}) {
  const [claim] = await db
    .insert(usageCostLedger)
    .values({
      userId: options.userId,
      provider: options.provider,
      operation: "broad_discovery_search",
      idempotencyKey: sensorRequestKey(options),
      units: "1",
      unitName: "request",
      estimatedCostUsd: options.provider === "brave" ? "0.005" : "0",
      reservationStatus: "reserved",
      metadata: { rotation: options.rotation },
    })
    .onConflictDoNothing()
    .returning({ id: usageCostLedger.id });
  return claim?.id ?? null;
}

async function settleSensorRequest(
  id: string,
  options: { resultCount: number; errorCode: string | null },
) {
  await db
    .update(usageCostLedger)
    .set({
      reservationStatus: "settled",
      metadata: options,
      updatedAt: new Date(),
    })
    .where(eq(usageCostLedger.id, id));
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function displayTenant(value: string) {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

async function registerCandidate(userId: string, candidate: DiscoveryCandidate) {
  let verifiedUrl = candidate.discoveredUrl;
  let resolved = resolveOfficialSource(verifiedUrl);
  if (!resolved && providerRights[candidate.sensor].mayResolveThirdPartyRedirects) {
    try {
      const redirect = await resolveSafeRedirect(verifiedUrl);
      verifiedUrl = redirect.url;
      resolved = resolveOfficialSource(verifiedUrl);
    } catch {
      return null;
    }
  }
  if (!resolved) return null;
  const tenantId = resolved.tenantId;
  const supportedAts = ["greenhouse", "lever", "ashby", "recruitee", "pinpoint"].includes(
    resolved.kind,
  );
  if (!supportedAts && resolved.kind !== "custom_jsonld") return null;
  if (supportedAts && !tenantId) return null;
  let officialIndex = resolved.officialUrl;
  let publicConfig: Record<string, unknown> = {};
  let authority:
    | Awaited<ReturnType<typeof verifyCompanyAuthority>>
    | Awaited<ReturnType<typeof verifyStructuredJobAuthority>> = null;
  if (resolved.kind === "custom_jsonld") {
    try {
      const structuredAuthority = await verifyStructuredJobAuthority(officialIndex);
      authority = structuredAuthority;
      publicConfig = structuredAuthority?.publicConfig ?? {};
    } catch {
      return null;
    }
  } else {
    officialIndex =
      resolved.kind === "greenhouse"
        ? `https://boards.greenhouse.io/${tenantId}`
        : resolved.kind === "lever"
          ? `https://jobs.lever.co/${tenantId}`
          : resolved.kind === "ashby"
            ? `https://jobs.ashbyhq.com/${tenantId}`
            : resolved.kind === "recruitee"
              ? `https://${tenantId}.recruitee.com`
              : `https://${tenantId}.pinpointhq.com`;
    try {
      authority = await verifyCompanyAuthority(officialIndex);
    } catch {
      return null;
    }
  }
  if (!authority) return null;
  const [existingSource] = await db
    .select({ id: globalCareerSources.id })
    .from(globalCareerSources)
    .where(
      tenantId
        ? and(
            eq(globalCareerSources.connectorKind, resolved.kind),
            eq(globalCareerSources.tenantId, tenantId),
          )
        : eq(globalCareerSources.normalizedUrl, officialIndex),
    )
    .limit(1);
  if (!existingSource && !(await mayAdmitColdSource())) return null;
  const name = authority.companyName || (tenantId ? displayTenant(tenantId) : "Unknown employer");
  const normalizedName = normalize(name);
  return db.transaction(async (tx) => {
    const [knownOrganization] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.normalizedName, normalizedName))
      .limit(1);
    const [organization] = knownOrganization
      ? [knownOrganization]
      : await tx
          .insert(organizations)
          .values({ name, normalizedName })
          .returning({ id: organizations.id });
    if (!organization) return null;
    const [company] = await tx
      .insert(companies)
      .values({
        userId,
        organizationId: organization.id,
        name,
        normalizedName,
        domain: null,
        origin: "discovered",
        priority: 4,
        provisional: true,
        discoveryEvidence: {
          sensor: candidate.sensor,
          discoveredAt: candidate.discoveredAt,
          authority: authority.evidence,
        },
      })
      .onConflictDoUpdate({
        target: [companies.userId, companies.normalizedName],
        // User dismissal and automated safety quarantine are sticky.
        set: {
          organizationId: sql`coalesce(${companies.organizationId}, ${organization.id})`,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!company?.active) return null;
    const [knownGlobalSource] = await tx
      .select({ id: globalCareerSources.id })
      .from(globalCareerSources)
      .where(
        tenantId
          ? and(
              eq(globalCareerSources.connectorKind, resolved.kind),
              eq(globalCareerSources.tenantId, tenantId),
            )
          : eq(globalCareerSources.normalizedUrl, officialIndex),
      )
      .limit(1);
    const [globalSource] = knownGlobalSource
      ? [knownGlobalSource]
      : await tx
          .insert(globalCareerSources)
          .values({
            organizationId: organization.id,
            connectorKind: resolved.kind,
            tenantId,
            baseUrl: officialIndex,
            normalizedUrl: officialIndex,
            publicConfig,
            parsingConfidence: authority.confidence,
          })
          .returning({ id: globalCareerSources.id });
    if (!globalSource) return null;
    const [source] = await tx
      .insert(careerSources)
      .values({
        userId,
        companyId: company.id,
        connectorKind: resolved.kind,
        baseUrl: officialIndex,
        normalizedUrl: officialIndex,
        publicConfig,
        parsingConfidence: 90,
        globalSourceId: globalSource.id,
      })
      .onConflictDoUpdate({
        target: [careerSources.userId, careerSources.normalizedUrl],
        set: { globalSourceId: globalSource.id, updatedAt: new Date() },
      })
      .returning();
    if (!source?.active) return null;
    await tx
      .insert(connectorRegistrations)
      .values({
        userId,
        careerSourceId: source.id,
        externalTenantId: tenantId,
        connectorVersion: connectorVersions[resolved.kind],
      })
      .onConflictDoUpdate({
        target: connectorRegistrations.careerSourceId,
        set: {
          externalTenantId: tenantId,
          connectorVersion: connectorVersions[resolved.kind],
          updatedAt: new Date(),
        },
      });
    await tx
      .insert(sourcePolicyReviews)
      .values({
        userId,
        careerSourceId: source.id,
        hostname: new URL(officialIndex).hostname,
        status: "approved",
        rationale:
          resolved.kind === "custom_jsonld"
            ? "Official public JobPosting data independently verified after transient discovery."
            : "Official public ATS endpoint discovered by a broad sensor.",
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
        nextScanAt: new Date(),
      })
      .onConflictDoNothing();
    await tx
      .insert(globalScanSchedules)
      .values({
        careerSourceId: globalSource.id,
        monitoringTier: "cold",
        cadenceMinutes: 240,
        nextRunAt: new Date(),
      })
      .onConflictDoUpdate({
        target: globalScanSchedules.careerSourceId,
        set: { active: true, nextRunAt: new Date(), updatedAt: new Date() },
      });
    await tx
      .insert(globalSourcePolicies)
      .values({
        careerSourceId: globalSource.id,
        provider: resolved.kind,
        policyVersion: "2026-08-04.1",
        status: "approved_official_public_source",
        mayRequest: true,
        mayUseTransiently: true,
        mayPersist: true,
        mayDisplay: true,
        expectedOrganization: name,
        closureMethod:
          resolved.kind === "custom_jsonld"
            ? "official_leaf_reverification"
            : "complete_official_feed",
        reviewedBy: "automatic-authority-verification",
        activatedAt: new Date(),
      })
      .onConflictDoNothing();
    await tx
      .insert(userCompanyFollows)
      .values({
        userId,
        organizationId: organization.id,
        interested: false,
        scope: "discovered",
        active: true,
        stickyDismissed: false,
      })
      .onConflictDoNothing();
    return { companyId: company.id, sourceId: source.id };
  });
}

export async function discoverBroadSources(
  userId: string,
  rotation = Math.floor(Date.now() / 14_400_000),
) {
  const env = serverEnv();
  const availableSensors = {
    brave: new BraveSensor(env.BRAVE_SEARCH_API_KEY),
    adzuna: new AdzunaSensor(env.ADZUNA_APP_ID, env.ADZUNA_APP_KEY),
  } as const;
  const sensors = activeDiscoveryProviders().map((provider) => availableSensors[provider]);
  const candidates: DiscoveryCandidate[] = [];
  const errors: string[] = [];
  for (const query of buildDiscoveryQueries(rotation))
    for (const sensor of sensors) {
      if (!(await sensorRequestAllowed(userId, sensor.kind))) {
        errors.push(`${sensor.kind}:MONTHLY_REQUEST_LIMIT`);
        continue;
      }
      const claimId = await claimSensorRequest({
        userId,
        provider: sensor.kind,
        rotation,
        query,
      });
      // The same rotation may be delivered twice or manually requested again.
      // Only the durable claimant is allowed to incur an external API request.
      if (!claimId) continue;
      let resultCount = 0;
      let errorCode: string | null = null;
      try {
        const results = await sensor.search(query);
        resultCount = results.length;
        candidates.push(...results);
      } catch (error) {
        errorCode = error instanceof Error ? error.name : "ERROR";
        errors.push(`${sensor.kind}:${errorCode}`);
      } finally {
        await settleSensorRequest(claimId, { resultCount, errorCode });
      }
    }
  const unique = new Map(candidates.map((candidate) => [candidate.discoveredUrl, candidate]));
  const sourceIds = new Set<string>();
  for (const candidate of unique.values()) {
    const registered = await registerCandidate(userId, candidate);
    if (registered) sourceIds.add(registered.sourceId);
  }
  return {
    sensorCandidates: unique.size,
    officialSources: sourceIds.size,
    sourceIds: [...sourceIds],
    errors,
  };
}

export async function promoteDiscoveredCompany(userId: string, companyId: string) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(companies)
      .set({ provisional: false, priority: 3, updatedAt: now })
      .where(and(eq(companies.userId, userId), eq(companies.id, companyId)));
    await tx
      .update(watchlists)
      .set({ monitoringTier: "warm", cadenceMinutes: 60, nextScanAt: now, updatedAt: now })
      .where(
        and(
          eq(watchlists.userId, userId),
          eq(watchlists.companyId, companyId),
          eq(watchlists.scope, "discovered"),
        ),
      );
  });
}
