import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  canonicalJobs,
  companies,
  eligibilityDecisions,
  queueStates,
  rankingDimensions,
  recommendations,
  referrals,
} from "@/db/schema";
import { freshness } from "@/domain/jobs";

export type QueueStatus = "active" | "saved" | "applied" | "dismissed";

export async function listQueue(userId: string, status: QueueStatus) {
  const rows = await db
    .select({
      jobId: canonicalJobs.id,
      title: canonicalJobs.title,
      company: companies.name,
      officialUrl: canonicalJobs.officialUrl,
      lifecycleStatus: canonicalJobs.lifecycleStatus,
      postedAt: canonicalJobs.postedAt,
      postedAtConfidence: canonicalJobs.postedAtConfidence,
      firstSeenAt: canonicalJobs.firstSeenAt,
      verifiedAt: canonicalJobs.verifiedAt,
      band: recommendations.band,
      urgency: recommendations.urgency,
      headline: recommendations.headline,
      strengths: recommendations.strengths,
      weaknesses: recommendations.weaknesses,
      routingReasons: recommendations.routingReasons,
      queueStatus: queueStates.status,
      rowVersion: queueStates.rowVersion,
    })
    .from(queueStates)
    .innerJoin(canonicalJobs, eq(queueStates.jobId, canonicalJobs.id))
    .innerJoin(companies, eq(canonicalJobs.companyId, companies.id))
    .leftJoin(
      recommendations,
      and(eq(recommendations.jobId, canonicalJobs.id), eq(recommendations.active, true)),
    )
    .where(
      and(
        eq(queueStates.userId, userId),
        eq(queueStates.status, status),
        ...(status === "active"
          ? [inArray(canonicalJobs.lifecycleStatus, ["open", "reopened"])]
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
  const companyRows = await db
    .select({ jobId: canonicalJobs.id, companyId: canonicalJobs.companyId })
    .from(canonicalJobs)
    .where(
      inArray(
        canonicalJobs.id,
        rows.map((row) => row.jobId),
      ),
    );
  const companyByJob = new Map(companyRows.map((row) => [row.jobId, row.companyId]));
  const now = new Date();
  return rows
    .map((row) => {
      const currentFreshness = freshness(
        now,
        row.postedAt,
        row.postedAtConfidence,
        row.firstSeenAt,
      );
      return {
        ...row,
        urgency: row.urgency === null ? null : Math.min(row.urgency, currentFreshness.value),
        freshnessBand: currentFreshness.band,
        hasReferral: referredCompanies.has(companyByJob.get(row.jobId) ?? ""),
      };
    })
    .toSorted((a, b) => (b.urgency ?? -1) - (a.urgency ?? -1));
}

export async function getJobDetail(userId: string, jobId: string) {
  const [job] = await db
    .select({
      id: canonicalJobs.id,
      title: canonicalJobs.title,
      company: companies.name,
      officialUrl: canonicalJobs.officialUrl,
      lifecycleStatus: canonicalJobs.lifecycleStatus,
      employmentType: canonicalJobs.employmentType,
      postedAt: canonicalJobs.postedAt,
      firstSeenAt: canonicalJobs.firstSeenAt,
      verifiedAt: canonicalJobs.verifiedAt,
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
    })
    .from(canonicalJobs)
    .innerJoin(companies, eq(canonicalJobs.companyId, companies.id))
    .leftJoin(queueStates, eq(queueStates.jobId, canonicalJobs.id))
    .leftJoin(
      recommendations,
      and(eq(recommendations.jobId, canonicalJobs.id), eq(recommendations.active, true)),
    )
    .leftJoin(
      eligibilityDecisions,
      eq(recommendations.eligibilityDecisionId, eligibilityDecisions.id),
    )
    .where(and(eq(canonicalJobs.userId, userId), eq(canonicalJobs.id, jobId)))
    .limit(1);
  if (!job) return null;
  const dimensions = await db
    .select()
    .from(rankingDimensions)
    .where(and(eq(rankingDimensions.userId, userId), eq(rankingDimensions.jobId, jobId)))
    .orderBy(rankingDimensions.dimension);
  const referralRows = await db
    .select()
    .from(referrals)
    .innerJoin(companies, eq(referrals.companyId, companies.id))
    .where(and(eq(referrals.userId, userId), eq(companies.name, job.company)));
  return { ...job, dimensions, referrals: referralRows.map((row) => row.referrals) };
}
