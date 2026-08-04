import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  canonicalJobs,
  careerSources,
  companies,
  eligibilityDecisions,
  jobDescriptionSnapshots,
  queueStates,
  rankingDimensions,
  recommendations,
  referrals,
} from "@/db/schema";
import {
  freshness,
  parseFeedSort,
  parsePostedWindow,
  withinPostedWindow,
  type FeedSort,
  type PostedWindow,
} from "@/domain/jobs";
import { ELIGIBILITY_RULE_VERSION } from "@/domain/eligibility";
import { RANKING_VERSION } from "@/domain/ranking";

export type QueueStatus = "active" | "saved" | "applied" | "dismissed";
export type FeedQuery = {
  postedWithin?: PostedWindow;
  sort?: FeedSort;
  query?: string;
  band?: "all" | "hot" | "strong" | "possible" | "review";
  referralsOnly?: boolean;
};

export async function listQueue(userId: string, status: QueueStatus, input: FeedQuery = {}) {
  const rows = await db
    .select({
      jobId: canonicalJobs.id,
      companyId: canonicalJobs.companyId,
      title: canonicalJobs.title,
      company: companies.name,
      officialUrl: canonicalJobs.officialUrl,
      lifecycleStatus: canonicalJobs.lifecycleStatus,
      postedAt: canonicalJobs.postedAt,
      postedAtConfidence: canonicalJobs.postedAtConfidence,
      firstSeenAt: canonicalJobs.firstSeenAt,
      reopenedAt: canonicalJobs.reopenedAt,
      verifiedAt: canonicalJobs.verifiedAt,
      band: recommendations.band,
      urgency: recommendations.urgency,
      headline: recommendations.headline,
      strengths: recommendations.strengths,
      weaknesses: recommendations.weaknesses,
      routingReasons: recommendations.routingReasons,
      eligibilityFacts: eligibilityDecisions.normalizedFacts,
      snapshotFacts: jobDescriptionSnapshots.normalizedFacts,
      snapshotCapturedAt: jobDescriptionSnapshots.capturedAt,
      materialChangeReasons: jobDescriptionSnapshots.materialChangeReasons,
      eligibilityRuleVersion: eligibilityDecisions.ruleVersion,
      rankingVersion: recommendations.rankingVersion,
      sourceKind: careerSources.connectorKind,
      sourceConfidence: careerSources.parsingConfidence,
      queueStatus: queueStates.status,
      rowVersion: queueStates.rowVersion,
    })
    .from(queueStates)
    .innerJoin(canonicalJobs, eq(queueStates.jobId, canonicalJobs.id))
    .innerJoin(companies, eq(canonicalJobs.companyId, companies.id))
    .innerJoin(careerSources, eq(canonicalJobs.authoritativeSourceId, careerSources.id))
    .leftJoin(
      recommendations,
      and(eq(recommendations.jobId, canonicalJobs.id), eq(recommendations.active, true)),
    )
    .leftJoin(
      eligibilityDecisions,
      eq(recommendations.eligibilityDecisionId, eligibilityDecisions.id),
    )
    .leftJoin(jobDescriptionSnapshots, eq(recommendations.snapshotId, jobDescriptionSnapshots.id))
    .where(
      and(
        eq(queueStates.userId, userId),
        eq(queueStates.status, status),
        ...(status === "active"
          ? [
              inArray(canonicalJobs.lifecycleStatus, ["open", "reopened"]),
              inArray(recommendations.band, ["hot", "strong", "possible", "review"]),
              eq(eligibilityDecisions.ruleVersion, ELIGIBILITY_RULE_VERSION),
              eq(recommendations.rankingVersion, RANKING_VERSION),
            ]
          : []),
      ),
    )
    .orderBy(desc(recommendations.urgency), desc(canonicalJobs.firstSeenAt));

  if (!rows.length) return [];
  const referralRows = await db
    .select({ companyId: referrals.companyId })
    .from(referrals)
    .where(
      and(
        eq(referrals.userId, userId),
        inArray(referrals.status, ["available", "requested", "submitted"]),
      ),
    );
  const referredCompanies = new Set(referralRows.map((row) => row.companyId));
  const now = new Date();
  return rows
    .map((row) => {
      const currentFreshness = freshness(
        now,
        row.postedAt,
        row.postedAtConfidence,
        row.firstSeenAt,
        row.reopenedAt,
      );
      const eligibilityFacts = row.eligibilityFacts as {
        locations?: { value?: unknown };
        workArrangement?: { value?: unknown };
      } | null;
      const snapshotFacts = row.snapshotFacts as { salary?: unknown } | null;
      const locations = Array.isArray(eligibilityFacts?.locations?.value)
        ? eligibilityFacts.locations.value.filter(
            (location): location is string => typeof location === "string" && Boolean(location),
          )
        : [];
      return {
        ...row,
        eligibilityFacts: undefined,
        snapshotFacts: undefined,
        urgency: row.urgency === null ? null : Math.min(row.urgency, currentFreshness.value),
        freshnessBand: currentFreshness.band,
        freshnessBasis: currentFreshness.basis,
        freshnessAgeHours: currentFreshness.ageHours,
        freshnessSection: currentFreshness.section,
        freshnessEffectiveAt: currentFreshness.effectiveAt,
        updated: (row.materialChangeReasons?.length ?? 0) > 0,
        location: locations.join(" · ") || "Location not provided",
        workArrangement:
          typeof eligibilityFacts?.workArrangement?.value === "string"
            ? eligibilityFacts.workArrangement.value
            : "unknown",
        salary: typeof snapshotFacts?.salary === "string" ? snapshotFacts.salary : null,
        hasReferral: referredCompanies.has(row.companyId),
      };
    })
    .filter((row) => {
      if (status !== "active") return true;
      const postedWithin = parsePostedWindow(input.postedWithin, "all");
      const query = input.query?.trim().toLowerCase() ?? "";
      return (
        withinPostedWindow(row.freshnessAgeHours, postedWithin) &&
        (!query || `${row.title} ${row.company}`.toLowerCase().includes(query)) &&
        (!input.band || input.band === "all" || row.band === input.band) &&
        (!input.referralsOnly || row.hasReferral)
      );
    })
    .toSorted((a, b) => {
      const sort = parseFeedSort(input.sort, status === "active" ? "posted_newest" : "urgency");
      if (sort === "detected_newest") return b.firstSeenAt.getTime() - a.firstSeenAt.getTime();
      if (sort === "urgency") return (b.urgency ?? -1) - (a.urgency ?? -1);
      return b.freshnessEffectiveAt.getTime() - a.freshnessEffectiveAt.getTime();
    });
}

export async function getJobDetail(userId: string, jobId: string) {
  const [job] = await db
    .select({
      id: canonicalJobs.id,
      companyId: companies.id,
      title: canonicalJobs.title,
      company: companies.name,
      officialUrl: canonicalJobs.officialUrl,
      lifecycleStatus: canonicalJobs.lifecycleStatus,
      employmentType: canonicalJobs.employmentType,
      postedAt: canonicalJobs.postedAt,
      postedAtConfidence: canonicalJobs.postedAtConfidence,
      firstSeenAt: canonicalJobs.firstSeenAt,
      reopenedAt: canonicalJobs.reopenedAt,
      lastSeenAt: canonicalJobs.lastSeenAt,
      verifiedAt: canonicalJobs.verifiedAt,
      sourceKind: careerSources.connectorKind,
      sourceConfidence: careerSources.parsingConfidence,
      band: recommendations.band,
      urgency: recommendations.urgency,
      headline: recommendations.headline,
      strengths: recommendations.strengths,
      weaknesses: recommendations.weaknesses,
      routingReasons: recommendations.routingReasons,
      status: queueStates.status,
      rowVersion: queueStates.rowVersion,
      eligibilityOutcome: eligibilityDecisions.outcome,
      eligibilityReasons: eligibilityDecisions.reasons,
      uncertainFields: eligibilityDecisions.uncertainFields,
      eligibilityFacts: eligibilityDecisions.normalizedFacts,
      descriptionText: jobDescriptionSnapshots.descriptionText,
      snapshotCapturedAt: jobDescriptionSnapshots.capturedAt,
      materialChangeReasons: jobDescriptionSnapshots.materialChangeReasons,
      recommendationSnapshotId: recommendations.snapshotId,
      rankingVersion: recommendations.rankingVersion,
    })
    .from(canonicalJobs)
    .innerJoin(companies, eq(canonicalJobs.companyId, companies.id))
    .innerJoin(careerSources, eq(canonicalJobs.authoritativeSourceId, careerSources.id))
    .leftJoin(
      queueStates,
      and(eq(queueStates.jobId, canonicalJobs.id), eq(queueStates.userId, userId)),
    )
    .leftJoin(
      recommendations,
      and(eq(recommendations.jobId, canonicalJobs.id), eq(recommendations.active, true)),
    )
    .leftJoin(
      eligibilityDecisions,
      eq(recommendations.eligibilityDecisionId, eligibilityDecisions.id),
    )
    .leftJoin(jobDescriptionSnapshots, eq(recommendations.snapshotId, jobDescriptionSnapshots.id))
    .where(and(eq(canonicalJobs.userId, userId), eq(canonicalJobs.id, jobId)))
    .limit(1);
  if (!job) return null;
  const dimensions = await db
    .select()
    .from(rankingDimensions)
    .where(
      and(
        eq(rankingDimensions.userId, userId),
        eq(rankingDimensions.jobId, jobId),
        ...(job.recommendationSnapshotId
          ? [eq(rankingDimensions.snapshotId, job.recommendationSnapshotId)]
          : []),
        ...(job.rankingVersion ? [eq(rankingDimensions.rankingVersion, job.rankingVersion)] : []),
      ),
    )
    .orderBy(rankingDimensions.dimension);
  const referralRows = await db
    .select()
    .from(referrals)
    .where(and(eq(referrals.userId, userId), eq(referrals.companyId, job.companyId)));
  const currentFreshness = freshness(
    new Date(),
    job.postedAt,
    job.postedAtConfidence,
    job.firstSeenAt,
    job.reopenedAt,
  );
  return {
    ...job,
    freshness: currentFreshness,
    dimensions,
    referrals: referralRows,
  };
}
