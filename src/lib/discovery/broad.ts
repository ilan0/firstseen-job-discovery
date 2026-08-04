import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { connectorVersions } from "@/connectors/versions";
import { db } from "@/db/client";
import {
  careerSources,
  companies,
  connectorRegistrations,
  sourcePolicyReviews,
  usageCostLedger,
  watchlists,
} from "@/db/schema";
import { buildDiscoveryQueries } from "@/discovery/queries";
import { resolveOfficialSource } from "@/discovery/resolve-official";
import { AdzunaSensor } from "@/discovery/sensors/adzuna";
import { BraveSensor } from "@/discovery/sensors/brave";
import type { DiscoveryCandidate } from "@/discovery/types";
import { serverEnv } from "@/lib/env/server";

const MONTHLY_SENSOR_REQUEST_LIMIT = 900;

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
  const resolved = resolveOfficialSource(candidate.discoveredUrl);
  if (!resolved || !resolved.tenantId || !["greenhouse", "lever", "ashby"].includes(resolved.kind))
    return null;
  const name = displayTenant(resolved.tenantId);
  const normalizedName = normalize(name);
  return db.transaction(async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({
        userId,
        name,
        normalizedName,
        domain: null,
        origin: "discovered",
        priority: 4,
        provisional: true,
        discoveryEvidence: {
          sensor: candidate.sensor,
          discoveredAt: candidate.discoveredAt,
          titleHint: candidate.titleHint,
        },
      })
      .onConflictDoUpdate({
        target: [companies.userId, companies.normalizedName],
        // User dismissal and automated safety quarantine are sticky.
        set: { updatedAt: new Date() },
      })
      .returning();
    if (!company?.active) return null;
    const officialIndex =
      resolved.kind === "greenhouse"
        ? `https://boards.greenhouse.io/${resolved.tenantId}`
        : resolved.kind === "lever"
          ? `https://jobs.lever.co/${resolved.tenantId}`
          : `https://jobs.ashbyhq.com/${resolved.tenantId}`;
    const [source] = await tx
      .insert(careerSources)
      .values({
        userId,
        companyId: company.id,
        connectorKind: resolved.kind,
        baseUrl: officialIndex,
        normalizedUrl: officialIndex,
        parsingConfidence: 90,
      })
      .onConflictDoUpdate({
        target: [careerSources.userId, careerSources.normalizedUrl],
        set: { updatedAt: new Date() },
      })
      .returning();
    if (!source?.active) return null;
    await tx
      .insert(connectorRegistrations)
      .values({
        userId,
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
      .insert(sourcePolicyReviews)
      .values({
        userId,
        careerSourceId: source.id,
        hostname: new URL(officialIndex).hostname,
        status: "approved",
        rationale: "Official public ATS endpoint discovered by a broad sensor.",
      })
      .onConflictDoNothing();
    await tx
      .insert(watchlists)
      .values({
        userId,
        companyId: company.id,
        cadenceMinutes: 240,
        nextScanAt: new Date(Date.now() + 240 * 60_000),
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
  const sensors = [
    new BraveSensor(env.BRAVE_SEARCH_API_KEY),
    new AdzunaSensor(env.ADZUNA_APP_ID, env.ADZUNA_APP_KEY),
  ];
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
  await db
    .update(companies)
    .set({ provisional: false, priority: 3, updatedAt: new Date() })
    .where(and(eq(companies.userId, userId), eq(companies.id, companyId)));
}
