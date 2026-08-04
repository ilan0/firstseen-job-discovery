import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { connectorFor } from "@/connectors/registry";
import type { ConnectorSource, NormalizedListing } from "@/connectors/types";
import type { ConnectorKind } from "@/connectors/versions";
import { db } from "@/db/client";
import {
  canonicalJobs,
  careerSources,
  companies,
  connectorRegistrations,
  eligibilityDecisions,
  rawObservations,
  recommendations,
  referrals,
} from "@/db/schema";
import { ELIGIBILITY_RULE_VERSION } from "@/domain/eligibility";
import { materialHash, normalizeOfficialUrl, transitionLifecycle } from "@/domain/jobs";
import { RANKING_VERSION } from "@/domain/ranking";
import { analyzeAndRankListing } from "@/lib/jobs/analyze-and-rank";
import { ingestListing } from "@/lib/jobs/ingest";
import { discoverAllPages } from "./discover-pages";

export type StoredSource = {
  id: string;
  userId: string;
  companyId: string;
  companyName: string;
  companyDomain: string;
  kind: ConnectorKind;
  baseUrl: string;
  tenantId: string | null;
  etag: string | null;
  lastModified: string | null;
};

export async function loadActiveSources(
  userId: string,
  companyId?: string,
): Promise<StoredSource[]> {
  const rows = await db
    .select({
      id: careerSources.id,
      userId: careerSources.userId,
      companyId: careerSources.companyId,
      companyName: companies.name,
      companyDomain: companies.domain,
      kind: careerSources.connectorKind,
      baseUrl: careerSources.baseUrl,
      tenantId: connectorRegistrations.externalTenantId,
      etag: connectorRegistrations.etag,
      lastModified: connectorRegistrations.lastModified,
    })
    .from(careerSources)
    .innerJoin(companies, eq(careerSources.companyId, companies.id))
    .leftJoin(connectorRegistrations, eq(connectorRegistrations.careerSourceId, careerSources.id))
    .where(
      and(
        eq(careerSources.userId, userId),
        eq(careerSources.active, true),
        eq(companies.active, true),
        ...(companyId ? [eq(companies.id, companyId)] : []),
      ),
    );
  return rows.map((row) => ({ ...row, companyDomain: row.companyDomain ?? row.companyName }));
}

function sourceInput(source: StoredSource): ConnectorSource {
  return {
    id: source.id,
    kind: source.kind,
    companyName: source.companyName,
    baseUrl: source.baseUrl,
    tenantId: source.tenantId,
    etag: source.etag,
    lastModified: source.lastModified,
  };
}

const stagedListingSchema = z.object({
  externalId: z.string().nullable(),
  requisitionId: z.string().nullable(),
  title: z.string(),
  officialUrl: z.string().url(),
  applyUrl: z.string().url(),
  locations: z.array(z.string()),
  workplaceType: z.string().nullable(),
  employmentType: z.string().nullable(),
  postedAt: z.string().nullable(),
  postedAtConfidence: z.enum(["low", "medium", "high"]),
  salaryText: z.string().nullable(),
  sourceConfidence: z.enum(["low", "medium", "high"]),
});

function stagedPayload(listing: NormalizedListing) {
  return {
    externalId: listing.externalId,
    requisitionId: listing.requisitionId,
    title: listing.title,
    officialUrl: listing.officialUrl,
    applyUrl: listing.applyUrl,
    locations: listing.locations,
    workplaceType: listing.workplaceType,
    employmentType: listing.employmentType,
    postedAt: listing.postedAt,
    postedAtConfidence: listing.postedAtConfidence,
    salaryText: listing.salaryText,
    sourceConfidence: listing.sourceConfidence,
  };
}

function stagingHash(listing: NormalizedListing) {
  return `discovery:${createHash("sha256")
    .update(`${listing.externalId ?? ""}\0${listing.officialUrl}\0${materialHash(listing)}`)
    .digest("hex")}`;
}

export type StagedSourceResult = {
  notModified: boolean;
  discovered: number;
  observationIds: string[];
  seenIds: string[];
  seenUrls: string[];
  etag: string | null;
  lastModified: string | null;
};

/** Fetches an official source once and durably stages only new or materially changed listings. */
export async function stageStoredSource(
  source: StoredSource,
  observedAt = new Date(),
  scanSourceRunId?: string | null,
): Promise<StagedSourceResult> {
  const connector = connectorFor(source.kind);
  const page = await discoverAllPages(connector, sourceInput(source));
  if (page.notModified)
    return {
      notModified: true,
      discovered: 0,
      observationIds: [],
      seenIds: [],
      seenUrls: [],
      etag: page.etag,
      lastModified: page.lastModified,
    };

  const normalizedUrls = [
    ...new Set(page.listings.map((item) => normalizeOfficialUrl(item.officialUrl))),
  ];
  const existing = normalizedUrls.length
    ? await db
        .select({
          jobId: canonicalJobs.id,
          normalizedUrl: canonicalJobs.normalizedOfficialUrl,
          materialHash: canonicalJobs.currentMaterialHash,
          ruleVersion: eligibilityDecisions.ruleVersion,
          rankingVersion: recommendations.rankingVersion,
        })
        .from(canonicalJobs)
        .leftJoin(
          recommendations,
          and(eq(recommendations.jobId, canonicalJobs.id), eq(recommendations.active, true)),
        )
        .leftJoin(
          eligibilityDecisions,
          eq(recommendations.eligibilityDecisionId, eligibilityDecisions.id),
        )
        .where(
          and(
            eq(canonicalJobs.userId, source.userId),
            inArray(canonicalJobs.normalizedOfficialUrl, normalizedUrls),
          ),
        )
    : [];
  const existingHashes = new Map(existing.map((job) => [job.normalizedUrl, job.materialHash]));
  const processingIsCurrent = new Set(
    existing
      .filter(
        (job) =>
          job.ruleVersion === ELIGIBILITY_RULE_VERSION && job.rankingVersion === RANKING_VERSION,
      )
      .map((job) => job.normalizedUrl),
  );
  const stagedRows = page.listings.map((listing) => {
    const normalizedUrl = normalizeOfficialUrl(listing.officialUrl);
    const unchanged =
      existingHashes.get(normalizedUrl) === materialHash(listing) &&
      processingIsCurrent.has(normalizedUrl);
    return {
      userId: source.userId,
      scanSourceRunId: scanSourceRunId ?? null,
      careerSourceId: source.id,
      externalJobId: listing.externalId,
      officialUrl: listing.officialUrl,
      observedAt,
      status: unchanged ? ("unchanged" as const) : ("discovered" as const),
      contentType: "application/normalized+json",
      contentHash: unchanged ? materialHash(listing) : stagingHash(listing),
      responseMetadata: listing.rawMetadata,
      normalizedPayload: stagedPayload(listing),
      sanitizedBody: listing.descriptionText.slice(0, 100_000),
      expiresAt: new Date(observedAt.getTime() + 30 * 86_400_000),
    };
  });
  if (stagedRows.length) await db.insert(rawObservations).values(stagedRows).onConflictDoNothing();

  const stagedHashes = stagedRows
    .filter((row) => row.status === "discovered")
    .map((row) => row.contentHash);
  const staged = stagedHashes.length
    ? await db
        .select({ id: rawObservations.id })
        .from(rawObservations)
        .where(
          and(
            eq(rawObservations.careerSourceId, source.id),
            eq(rawObservations.observedAt, observedAt),
            eq(rawObservations.status, "discovered"),
            inArray(rawObservations.contentHash, stagedHashes),
          ),
        )
    : [];
  const unchangedUrls = stagedRows
    .filter((row) => row.status === "unchanged")
    .map((row) => normalizeOfficialUrl(row.officialUrl));
  if (unchangedUrls.length)
    await db
      .update(canonicalJobs)
      .set({
        lifecycleStatus: "open",
        verifiedAt: observedAt,
        lastSeenAt: observedAt,
        consecutiveSuccessfulMisses: 0,
        possiblyClosedAt: null,
        closedAt: null,
        reopenedAt: sql`case when ${canonicalJobs.lifecycleStatus} in ('closed', 'possibly_closed') then ${observedAt.toISOString()} else ${canonicalJobs.reopenedAt} end`,
        updatedAt: observedAt,
      })
      .where(
        and(
          eq(canonicalJobs.userId, source.userId),
          inArray(canonicalJobs.normalizedOfficialUrl, unchangedUrls),
        ),
      );

  return {
    notModified: false,
    discovered: page.listings.length,
    observationIds: staged.map((row) => row.id),
    seenIds: page.listings
      .map((listing) => listing.externalId)
      .filter((value): value is string => Boolean(value)),
    seenUrls: page.listings.map((listing) => listing.officialUrl),
    etag: page.etag,
    lastModified: page.lastModified,
  };
}

export async function processStagedListing(source: StoredSource, observationId: string) {
  const [observation] = await db
    .select()
    .from(rawObservations)
    .where(
      and(
        eq(rawObservations.id, observationId),
        eq(rawObservations.userId, source.userId),
        eq(rawObservations.careerSourceId, source.id),
      ),
    )
    .limit(1);
  if (!observation) throw new Error("Staged listing was not found");
  const payload = stagedListingSchema.parse(observation.normalizedPayload);
  const listing: NormalizedListing = {
    ...payload,
    descriptionText: observation.sanitizedBody ?? "",
    rawMetadata:
      observation.responseMetadata && typeof observation.responseMetadata === "object"
        ? (observation.responseMetadata as Record<string, unknown>)
        : {},
  };
  const referralRows = await db
    .select({ id: referrals.id })
    .from(referrals)
    .where(and(eq(referrals.userId, source.userId), eq(referrals.companyId, source.companyId)))
    .limit(1);
  const ingest = await ingestListing(
    {
      userId: source.userId,
      companyId: source.companyId,
      companyDomain: source.companyDomain,
      sourceId: source.id,
      connectorKind: source.kind,
      tenantId: source.tenantId,
      observedAt: observation.observedAt,
      scanSourceRunId: observation.scanSourceRunId,
    },
    listing,
  );
  const result = await analyzeAndRankListing({
    userId: source.userId,
    listing,
    ingest,
    hasReferral: referralRows.length > 0,
    now: observation.observedAt,
  });
  const exceptional =
    result.state === "analyzed" &&
    result.recommendation.band === "hot" &&
    result.recommendation.urgency >= 85 &&
    ingest.snapshotId
      ? [
          {
            jobId: ingest.jobId,
            snapshotId: ingest.snapshotId,
            title: listing.title,
            company: source.companyName,
            headline: result.recommendation.headline,
            urgency: result.recommendation.urgency,
            hasReferral: referralRows.length > 0,
          },
        ]
      : [];
  return {
    changed: ingest.changed ? 1 : 0,
    analyzed: result.state === "analyzed" ? 1 : 0,
    exceptional,
  };
}

export async function finalizeStagedSource(
  source: StoredSource,
  staged: StagedSourceResult,
  processed: Awaited<ReturnType<typeof processStagedListing>>[],
  observedAt = new Date(),
) {
  const changed = processed.reduce((sum, item) => sum + item.changed, 0);
  const analyzed = processed.reduce((sum, item) => sum + item.analyzed, 0);
  const exceptional = processed.flatMap((item) => item.exceptional);
  if (analyzed > 0)
    await db
      .update(companies)
      .set({ provisional: false, priority: 3, updatedAt: observedAt })
      .where(
        and(
          eq(companies.userId, source.userId),
          eq(companies.id, source.companyId),
          eq(companies.provisional, true),
        ),
      );
  if (!staged.notModified) {
    const existing = await db
      .select()
      .from(canonicalJobs)
      .where(
        and(
          eq(canonicalJobs.userId, source.userId),
          eq(canonicalJobs.authoritativeSourceId, source.id),
        ),
      );
    const seenIdSet = new Set(staged.seenIds);
    const seenUrls = new Set(staged.seenUrls);
    const missing = existing.filter(
      (job) =>
        (!job.externalJobId || !seenIdSet.has(job.externalJobId)) && !seenUrls.has(job.officialUrl),
    );
    for (const job of missing) {
      const next = transitionLifecycle(
        {
          status: job.lifecycleStatus,
          consecutiveSuccessfulMisses: job.consecutiveSuccessfulMisses,
          possiblyClosedAt: job.possiblyClosedAt,
          closedAt: job.closedAt,
          reopenedAt: job.reopenedAt,
        },
        "missing",
        source.kind,
        observedAt,
      );
      await db
        .update(canonicalJobs)
        .set({
          lifecycleStatus: next.status,
          consecutiveSuccessfulMisses: next.consecutiveSuccessfulMisses,
          possiblyClosedAt: next.possiblyClosedAt,
          closedAt: next.closedAt,
          reopenedAt: next.reopenedAt,
          updatedAt: observedAt,
        })
        .where(eq(canonicalJobs.id, job.id));
    }
  }
  await db.transaction(async (tx) => {
    await tx
      .update(careerSources)
      .set({
        lastAttemptAt: observedAt,
        lastSuccessAt: observedAt,
        lastErrorCode: null,
        updatedAt: observedAt,
      })
      .where(eq(careerSources.id, source.id));
    await tx
      .update(connectorRegistrations)
      .set({
        etag: staged.etag,
        lastModified: staged.lastModified,
        cursorState: {},
        updatedAt: observedAt,
      })
      .where(eq(connectorRegistrations.careerSourceId, source.id));
  });
  return {
    discovered: staged.discovered,
    changed,
    analyzed,
    exceptional,
    notModified: staged.notModified,
  };
}

export async function scanStoredSource(
  source: StoredSource,
  observedAt = new Date(),
  scanSourceRunId?: string | null,
) {
  const staged = await stageStoredSource(source, observedAt, scanSourceRunId);
  const processed = [];
  for (const observationId of staged.observationIds)
    processed.push(await processStagedListing(source, observationId));
  return finalizeStagedSource(source, staged, processed, observedAt);
}
