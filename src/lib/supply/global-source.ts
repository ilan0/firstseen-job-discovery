import "server-only";

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { connectorFor } from "@/connectors/registry";
import type { ConnectorSource, NormalizedListing } from "@/connectors/types";
import type { ConnectorKind } from "@/connectors/versions";
import { db } from "@/db/client";
import {
  canonicalJobs,
  careerSources,
  companies,
  globalCareerSources,
  globalJobLifecycleEvents,
  globalJobSnapshots,
  globalJobs,
  globalScanRuns,
  globalSourcePolicies,
  jobDescriptionSnapshots,
  queueStates,
  userJobEligibility,
  userJobQueueStates,
  userJobRankingDimensions,
  userRecommendations,
  organizations,
  referrals,
} from "@/db/schema";
import { freshness, normalizeOfficialUrl, transitionLifecycle } from "@/domain/jobs";
import { ELIGIBILITY_RULE_VERSION } from "@/domain/eligibility";
import { analyzeAndRankListing } from "@/lib/jobs/analyze-and-rank";
import { ingestListing } from "@/lib/jobs/ingest";
import { discoverAllPages } from "@/lib/scans/discover-pages";
import type { StoredSource } from "@/lib/scans/scan-source";
import { ingestGlobalListing, type GlobalIngestResult } from "./global-ingest";
import type { SharedRequirementExtraction } from "./requirement-extraction";

export type StoredGlobalSource = {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationDomain: string;
  kind: ConnectorKind;
  tenantId: string | null;
  baseUrl: string;
  publicConfig: Record<string, unknown>;
  etag: string | null;
  lastModified: string | null;
};

export type GlobalListingTask = {
  sourceId: string;
  jobId: string;
  snapshotId: string;
  changed: boolean;
  reopened: boolean;
  observedAt: string;
};

export type GlobalPersonalizationTask = {
  source: StoredSource;
  listing: NormalizedListing;
  global: GlobalIngestResult;
};

const storedFactsSchema = z.object({
  employmentType: z.string().nullable(),
  locations: z.array(z.string()),
  workplaceType: z.string().nullable(),
  salary: z.string().nullable(),
  sourceFacts: z
    .object({
      employmentType: z.string().nullable(),
      locations: z.array(z.string()),
      workplaceType: z.string().nullable(),
      salaryText: z.string().nullable(),
      sourceConfidence: z.enum(["low", "medium", "high"]),
    })
    .optional(),
});

export async function loadGlobalSource(sourceId: string): Promise<StoredGlobalSource | null> {
  const [source] = await db
    .select({
      id: globalCareerSources.id,
      organizationId: globalCareerSources.organizationId,
      organizationName: organizations.name,
      organizationDomain: organizations.canonicalDomain,
      kind: globalCareerSources.connectorKind,
      tenantId: globalCareerSources.tenantId,
      baseUrl: globalCareerSources.baseUrl,
      publicConfig: globalCareerSources.publicConfig,
      etag: globalCareerSources.etag,
      lastModified: globalCareerSources.lastModified,
    })
    .from(globalCareerSources)
    .innerJoin(organizations, eq(globalCareerSources.organizationId, organizations.id))
    .where(
      and(
        eq(globalCareerSources.id, sourceId),
        eq(globalCareerSources.active, true),
        eq(organizations.active, true),
        sql`exists (
          select 1
          from ${globalSourcePolicies} source_policy
          where source_policy.career_source_id = ${globalCareerSources.id}
            and source_policy.may_request = true
            and source_policy.activated_at is not null
        )`,
      ),
    )
    .limit(1);
  if (!source) return null;
  return {
    ...source,
    organizationDomain: source.organizationDomain ?? source.organizationName,
    publicConfig:
      source.publicConfig && typeof source.publicConfig === "object"
        ? (source.publicConfig as Record<string, unknown>)
        : {},
  };
}

function connectorInput(source: StoredGlobalSource): ConnectorSource {
  return {
    id: source.id,
    kind: source.kind,
    companyName: source.organizationName,
    baseUrl: source.baseUrl,
    tenantId: source.tenantId,
    publicConfig: source.publicConfig,
    etag: source.etag,
    lastModified: source.lastModified,
  };
}

export async function loadGlobalSourceOverlays(
  sourceId: string,
  userId?: string,
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
      tenantId: globalCareerSources.tenantId,
    })
    .from(careerSources)
    .innerJoin(companies, eq(careerSources.companyId, companies.id))
    .innerJoin(globalCareerSources, eq(careerSources.globalSourceId, globalCareerSources.id))
    .where(
      and(
        eq(careerSources.globalSourceId, sourceId),
        ...(userId ? [eq(careerSources.userId, userId)] : []),
        eq(careerSources.active, true),
        eq(companies.active, true),
      ),
    );
  return rows.map((row) => ({
    ...row,
    companyDomain: row.companyDomain ?? row.companyName,
    etag: null,
    lastModified: null,
  }));
}

export async function personalizeGlobalListing(
  source: StoredSource,
  listing: NormalizedListing,
  global: GlobalIngestResult,
  sharedExtraction: SharedRequirementExtraction,
  observedAt: Date,
) {
  const [referral] = await db
    .select({ id: referrals.id })
    .from(referrals)
    .where(and(eq(referrals.userId, source.userId), eq(referrals.companyId, source.companyId)))
    .limit(1);
  const legacy = await ingestListing(
    {
      userId: source.userId,
      companyId: source.companyId,
      companyDomain: source.companyDomain,
      sourceId: source.id,
      connectorKind: source.kind,
      tenantId: source.tenantId,
      observedAt,
    },
    listing,
  );
  const projectedReopening = global.reopened && global.reopenedAt ? global.reopenedAt : null;
  await db
    .update(canonicalJobs)
    .set({
      globalJobId: global.jobId,
      firstSeenAt: sql`least(${canonicalJobs.firstSeenAt}, ${global.firstSeenAt.toISOString()}::timestamptz)`,
      ...(projectedReopening
        ? { lifecycleStatus: "reopened" as const, reopenedAt: projectedReopening }
        : {}),
      updatedAt: observedAt,
    })
    .where(and(eq(canonicalJobs.id, legacy.jobId), eq(canonicalJobs.userId, source.userId)));
  if (legacy.snapshotId)
    await db
      .update(jobDescriptionSnapshots)
      .set({ globalSnapshotId: global.snapshotId, updatedAt: observedAt })
      .where(
        and(
          eq(jobDescriptionSnapshots.id, legacy.snapshotId),
          eq(jobDescriptionSnapshots.userId, source.userId),
        ),
      );
  const projectedIngest = {
    ...legacy,
    firstSeenAt: global.firstSeenAt,
    reopened: legacy.reopened || Boolean(projectedReopening),
    reopenedAt: legacy.reopenedAt ?? projectedReopening,
  };
  const result = await analyzeAndRankListing({
    userId: source.userId,
    listing,
    ingest: projectedIngest,
    hasReferral: Boolean(referral),
    now: observedAt,
    sharedExtraction,
  });
  if (result.state === "analyzed")
    await db.transaction(async (tx) => {
      const [eligibility] = await tx
        .insert(userJobEligibility)
        .values({
          userId: source.userId,
          jobId: global.jobId,
          snapshotId: global.snapshotId,
          extractionId: sharedExtraction.id,
          outcome: result.decision.outcome,
          ruleVersion: ELIGIBILITY_RULE_VERSION,
          reasons: result.decision.reasons,
          evidence: result.decision.reasons.flatMap((reason) => reason.evidence),
          uncertainFields: result.decision.uncertainFields,
          evaluatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: [
            userJobEligibility.userId,
            userJobEligibility.snapshotId,
            userJobEligibility.ruleVersion,
          ],
          set: {
            extractionId: sharedExtraction.id,
            outcome: result.decision.outcome,
            reasons: result.decision.reasons,
            evidence: result.decision.reasons.flatMap((reason) => reason.evidence),
            uncertainFields: result.decision.uncertainFields,
            evaluatedAt: observedAt,
            updatedAt: observedAt,
          },
        })
        .returning({ id: userJobEligibility.id });
      if (!eligibility) throw new Error("Personalized global eligibility could not be saved");
      for (const dimension of result.recommendation.dimensions)
        await tx
          .insert(userJobRankingDimensions)
          .values({
            userId: source.userId,
            jobId: global.jobId,
            snapshotId: global.snapshotId,
            dimension: dimension.dimension,
            value: dimension.value,
            confidence: dimension.confidence,
            explanation: dimension.explanation,
            evidence: dimension.evidence,
            rankingVersion: result.recommendation.version,
          })
          .onConflictDoUpdate({
            target: [
              userJobRankingDimensions.userId,
              userJobRankingDimensions.snapshotId,
              userJobRankingDimensions.dimension,
              userJobRankingDimensions.rankingVersion,
            ],
            set: {
              value: dimension.value,
              confidence: dimension.confidence,
              explanation: dimension.explanation,
              evidence: dimension.evidence,
              updatedAt: observedAt,
            },
          });
      await tx
        .update(userRecommendations)
        .set({ active: false, updatedAt: observedAt })
        .where(
          and(
            eq(userRecommendations.userId, source.userId),
            eq(userRecommendations.jobId, global.jobId),
            eq(userRecommendations.active, true),
          ),
        );
      await tx
        .insert(userRecommendations)
        .values({
          userId: source.userId,
          jobId: global.jobId,
          snapshotId: global.snapshotId,
          eligibilityId: eligibility.id,
          band: result.recommendation.band,
          urgency: result.recommendation.urgency,
          headline: result.recommendation.headline,
          primaryConcern: result.recommendation.routingReasons[0] ?? null,
          rankingVersion: result.recommendation.version,
          active: true,
          recommendedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: [
            userRecommendations.userId,
            userRecommendations.snapshotId,
            userRecommendations.rankingVersion,
          ],
          set: {
            eligibilityId: eligibility.id,
            band: result.recommendation.band,
            urgency: result.recommendation.urgency,
            headline: result.recommendation.headline,
            primaryConcern: result.recommendation.routingReasons[0] ?? null,
            active: true,
            updatedAt: observedAt,
          },
        });
      if (result.recommendation.band !== "not_recommended")
        await tx
          .insert(userJobQueueStates)
          .values({ userId: source.userId, jobId: global.jobId, status: "active" })
          .onConflictDoNothing();
    });
  const [queue] = await db
    .select({ status: queueStates.status })
    .from(queueStates)
    .where(and(eq(queueStates.userId, source.userId), eq(queueStates.jobId, legacy.jobId)))
    .limit(1);
  const [latestSnapshot] = projectedIngest.snapshotId
    ? [{ id: projectedIngest.snapshotId }]
    : projectedIngest.reopened
      ? await db
          .select({ id: jobDescriptionSnapshots.id })
          .from(jobDescriptionSnapshots)
          .where(
            and(
              eq(jobDescriptionSnapshots.userId, source.userId),
              eq(jobDescriptionSnapshots.jobId, legacy.jobId),
            ),
          )
          .orderBy(sql`${jobDescriptionSnapshots.capturedAt} desc`)
          .limit(1)
      : [];
  const currentFreshness = freshness(
    observedAt,
    projectedIngest.postedAt,
    projectedIngest.postedAtConfidence,
    projectedIngest.firstSeenAt,
    projectedIngest.reopenedAt,
  );
  const exceptional =
    result.state === "analyzed" &&
    (result.recommendation.band === "hot" || result.recommendation.band === "strong") &&
    result.recommendation.urgency >= 85 &&
    currentFreshness.ageHours <= 24 &&
    currentFreshness.basis !== "first_seen" &&
    queue?.status === "active" &&
    latestSnapshot?.id
      ? {
          jobId: legacy.jobId,
          snapshotId: latestSnapshot.id,
          title: listing.title,
          company: source.companyName,
          headline: result.recommendation.headline,
          urgency: result.recommendation.urgency,
          hasReferral: Boolean(referral),
          band: result.recommendation.band,
          officialUrl: listing.officialUrl,
          freshnessAgeHours: currentFreshness.ageHours,
          freshnessBasis: currentFreshness.basis,
          primaryConcern:
            result.recommendation.routingReasons[0] ?? "No material concern identified.",
          occurrenceId:
            projectedIngest.reopened && projectedIngest.reopenedAt
              ? `reopened:${projectedIngest.reopenedAt.toISOString()}`
              : `snapshot:${latestSnapshot.id}`,
        }
      : null;
  return {
    userId: source.userId,
    legacyJobId: legacy.jobId,
    state: result.state,
    changed: legacy.changed,
    exceptional,
  };
}

export async function loadGlobalListingTasks(sourceId: string): Promise<GlobalListingTask[]> {
  const jobs = await db
    .select({
      jobId: globalJobs.id,
      snapshotId: globalJobs.currentSnapshotId,
      reopenedAt: globalJobs.reopenedAt,
      observedAt: globalJobs.lastSeenAt,
    })
    .from(globalJobs)
    .where(
      and(
        eq(globalJobs.authoritativeSourceId, sourceId),
        inArray(globalJobs.lifecycleStatus, ["open", "reopened"]),
        isNotNull(globalJobs.currentSnapshotId),
      ),
    );
  return jobs.flatMap((job) =>
    job.snapshotId
      ? [
          {
            sourceId,
            jobId: job.jobId,
            snapshotId: job.snapshotId,
            changed: false,
            reopened: Boolean(job.reopenedAt),
            observedAt: job.observedAt.toISOString(),
          },
        ]
      : [],
  );
}

export async function loadGlobalPersonalizationTask(options: {
  sourceId: string;
  jobId: string;
  snapshotId: string;
  userId: string;
}): Promise<GlobalPersonalizationTask | null> {
  const [row] = await db
    .select({
      externalId: globalJobs.externalJobId,
      requisitionId: globalJobs.requisitionId,
      title: globalJobs.title,
      officialUrl: globalJobs.officialUrl,
      applyUrl: globalJobs.applyUrl,
      postedAt: globalJobs.postedAt,
      postedAtConfidence: globalJobs.postedAtConfidence,
      firstSeenAt: globalJobs.firstSeenAt,
      lifecycleStatus: globalJobs.lifecycleStatus,
      reopenedAt: globalJobs.reopenedAt,
      snapshotId: globalJobSnapshots.id,
      descriptionText: globalJobSnapshots.descriptionText,
      normalizedFacts: globalJobSnapshots.normalizedFacts,
    })
    .from(globalJobs)
    .innerJoin(globalJobSnapshots, eq(globalJobSnapshots.jobId, globalJobs.id))
    .where(
      and(
        eq(globalJobs.id, options.jobId),
        eq(globalJobs.authoritativeSourceId, options.sourceId),
        eq(globalJobs.currentSnapshotId, options.snapshotId),
        inArray(globalJobs.lifecycleStatus, ["open", "reopened"]),
        eq(globalJobSnapshots.id, options.snapshotId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const [source] = await loadGlobalSourceOverlays(options.sourceId, options.userId);
  if (!source) return null;
  const facts = storedFactsSchema.safeParse(row.normalizedFacts);
  if (!facts.success) throw new Error("The persisted global listing facts are invalid.");
  const original = facts.data.sourceFacts;
  return {
    source,
    listing: {
      externalId: row.externalId,
      requisitionId: row.requisitionId,
      title: row.title,
      descriptionText: row.descriptionText,
      officialUrl: row.officialUrl,
      applyUrl: row.applyUrl,
      locations: original?.locations ?? facts.data.locations,
      workplaceType: original?.workplaceType ?? facts.data.workplaceType,
      employmentType: original?.employmentType ?? facts.data.employmentType,
      postedAt: row.postedAt?.toISOString() ?? null,
      postedAtConfidence: row.postedAtConfidence,
      salaryText: original?.salaryText ?? facts.data.salary,
      sourceConfidence: original?.sourceConfidence ?? "high",
      rawMetadata: {},
    },
    global: {
      jobId: options.jobId,
      snapshotId: row.snapshotId,
      changed: false,
      reopened: row.lifecycleStatus === "reopened" && Boolean(row.reopenedAt),
      firstSeenAt: row.firstSeenAt,
      postedAt: row.postedAt,
      postedAtConfidence: row.postedAtConfidence,
      reopenedAt: row.reopenedAt,
    },
  };
}

export async function applyGlobalClosure(
  source: StoredGlobalSource,
  listings: NormalizedListing[],
  observedAt: Date,
) {
  const jobs = await db
    .select()
    .from(globalJobs)
    .where(eq(globalJobs.authoritativeSourceId, source.id));
  const seenIds = new Set(
    listings.map((listing) => listing.externalId).filter((id): id is string => Boolean(id)),
  );
  const seenUrls = new Set(listings.map((listing) => normalizeOfficialUrl(listing.officialUrl)));
  let transitioned = 0;
  for (const job of jobs) {
    if (
      (job.externalJobId && seenIds.has(job.externalJobId)) ||
      seenUrls.has(job.normalizedOfficialUrl)
    )
      continue;
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
    await db.transaction(async (tx) => {
      if (next.status !== job.lifecycleStatus) {
        transitioned += 1;
        await tx.insert(globalJobLifecycleEvents).values({
          jobId: job.id,
          fromStatus: job.lifecycleStatus,
          toStatus: next.status,
          reason:
            next.status === "closed" ? "Missing from complete official feed" : "Possibly missing",
          evidence: { sourceId: source.id, complete: true },
          occurredAt: observedAt,
        });
      }
      const lifecycleFields = {
        lifecycleStatus: next.status,
        consecutiveSuccessfulMisses: next.consecutiveSuccessfulMisses,
        possiblyClosedAt: next.possiblyClosedAt,
        closedAt: next.closedAt,
        reopenedAt: next.reopenedAt,
        updatedAt: observedAt,
      } as const;
      await tx.update(globalJobs).set(lifecycleFields).where(eq(globalJobs.id, job.id));
      // The personalized queue still reads legacy-compatible job projections
      // during the forward-only migration. Keep every linked private row in
      // lifecycle lockstep with the single authoritative global observation.
      await tx
        .update(canonicalJobs)
        .set(lifecycleFields)
        .where(eq(canonicalJobs.globalJobId, job.id));
    });
  }
  return transitioned;
}

/** Fetches one official source once, then fans personalized analysis out to all watchers. */
export async function scanGlobalSource(
  source: StoredGlobalSource,
  observedAt = new Date(),
  scanRunId?: string | null,
) {
  const connector = connectorFor(source.kind);
  const page = await discoverAllPages(connector, connectorInput(source));
  const overlays = await loadGlobalSourceOverlays(source.id);
  if (page.notModified) {
    await db.transaction(async (tx) => {
      await tx
        .update(globalCareerSources)
        .set({
          lastAttemptAt: observedAt,
          lastSuccessAt: observedAt,
          lastErrorCode: null,
          updatedAt: observedAt,
        })
        .where(eq(globalCareerSources.id, source.id));
      if (overlays.length)
        await tx
          .update(careerSources)
          .set({
            lastAttemptAt: observedAt,
            lastSuccessAt: observedAt,
            lastErrorCode: null,
            updatedAt: observedAt,
          })
          .where(
            inArray(
              careerSources.id,
              overlays.map((overlay) => overlay.id),
            ),
          );
    });
    return {
      notModified: true,
      discovered: 0,
      changed: 0,
      personalized: 0,
      closed: 0,
      tasks: [] as GlobalListingTask[],
    };
  }

  const globalResults = new Map<string, GlobalIngestResult>();
  for (const listing of page.listings) {
    const result = await ingestGlobalListing(
      {
        organizationId: source.organizationId,
        organizationDomain: source.organizationDomain,
        sourceId: source.id,
        connectorKind: source.kind,
        tenantId: source.tenantId,
        observedAt,
        scanRunId: scanRunId ?? null,
      },
      listing,
    );
    globalResults.set(normalizeOfficialUrl(listing.officialUrl), result);
  }

  const closed = await applyGlobalClosure(source, page.listings, observedAt);
  await db.transaction(async (tx) => {
    await tx
      .update(globalCareerSources)
      .set({
        etag: page.etag,
        lastModified: page.lastModified,
        lastAttemptAt: observedAt,
        lastSuccessAt: observedAt,
        lastErrorCode: null,
        updatedAt: observedAt,
      })
      .where(eq(globalCareerSources.id, source.id));
    if (scanRunId)
      await tx
        .update(globalScanRuns)
        .set({ observationCount: page.listings.length, updatedAt: observedAt })
        .where(eq(globalScanRuns.id, scanRunId));
    if (overlays.length)
      await tx
        .update(careerSources)
        .set({
          lastAttemptAt: observedAt,
          lastSuccessAt: observedAt,
          lastErrorCode: null,
          updatedAt: observedAt,
        })
        .where(
          inArray(
            careerSources.id,
            overlays.map((overlay) => overlay.id),
          ),
        );
  });
  return {
    notModified: false,
    discovered: page.listings.length,
    changed: [...globalResults.values()].filter((result) => result.changed).length,
    personalized: 0,
    closed,
    tasks: [...globalResults.values()]
      .filter((result) => result.changed || result.reopened)
      .map((result) => ({
        sourceId: source.id,
        jobId: result.jobId,
        snapshotId: result.snapshotId,
        changed: result.changed,
        reopened: result.reopened,
        observedAt: observedAt.toISOString(),
      })),
  };
}
