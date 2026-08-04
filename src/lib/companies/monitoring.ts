import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  canonicalJobs,
  careerSources,
  companies,
  eligibilityDecisions,
  queueStates,
  recommendations,
  referrals,
  watchlists,
} from "@/db/schema";
import {
  deriveMonitoringPolicy,
  isRecentViableRecommendation,
} from "@/domain/companies/monitoring";
import { freshness } from "@/domain/jobs";
import { refreshGlobalSourceDemand } from "@/lib/supply/demand";

export async function refreshCompanyMonitoring(
  userId: string,
  companyId: string,
  now = new Date(),
) {
  const [company] = await db
    .select({ interested: companies.interested })
    .from(companies)
    .where(
      and(eq(companies.userId, userId), eq(companies.id, companyId), eq(companies.active, true)),
    )
    .limit(1);
  const [watch] = await db
    .select()
    .from(watchlists)
    .where(and(eq(watchlists.userId, userId), eq(watchlists.companyId, companyId)))
    .limit(1);
  if (!company || !watch) return null;
  const [activeReferral] = await db
    .select({ id: referrals.id })
    .from(referrals)
    .where(
      and(
        eq(referrals.userId, userId),
        eq(referrals.companyId, companyId),
        inArray(referrals.status, ["available", "requested", "agreed", "submitted"]),
      ),
    )
    .limit(1);
  const viableRows = await db
    .select({
      band: recommendations.band,
      eligibilityOutcome: eligibilityDecisions.outcome,
      postedAt: canonicalJobs.postedAt,
      postedAtConfidence: canonicalJobs.postedAtConfidence,
      firstSeenAt: canonicalJobs.firstSeenAt,
      reopenedAt: canonicalJobs.reopenedAt,
    })
    .from(recommendations)
    .innerJoin(canonicalJobs, eq(recommendations.jobId, canonicalJobs.id))
    .innerJoin(
      eligibilityDecisions,
      eq(recommendations.eligibilityDecisionId, eligibilityDecisions.id),
    )
    .innerJoin(
      queueStates,
      and(eq(queueStates.jobId, canonicalJobs.id), eq(queueStates.userId, userId)),
    )
    .where(
      and(
        eq(recommendations.userId, userId),
        eq(recommendations.active, true),
        eq(canonicalJobs.companyId, companyId),
        inArray(canonicalJobs.lifecycleStatus, ["open", "reopened"]),
        eq(queueStates.status, "active"),
      ),
    );
  const hasRecentViableMatch = viableRows.some((row) =>
    isRecentViableRecommendation({
      band: row.band,
      eligibilityOutcome: row.eligibilityOutcome,
      ageHours: freshness(
        now,
        row.postedAt,
        row.postedAtConfidence,
        row.firstSeenAt,
        row.reopenedAt,
      ).ageHours,
    }),
  );
  const policy = deriveMonitoringPolicy({
    scope: watch.scope,
    interested: company.interested,
    hasActiveReferral: Boolean(activeReferral),
    hasRecentViableMatch,
    quarantined: watch.monitoringTier === "quarantined",
  });
  await db
    .update(watchlists)
    .set({
      active: policy.active,
      cadenceMinutes: policy.cadenceMinutes,
      monitoringTier: policy.tier,
      nextScanAt: !policy.active
        ? watch.nextScanAt
        : policy.cadenceMinutes < watch.cadenceMinutes && watch.nextScanAt > now
          ? now
          : policy.cadenceMinutes > watch.cadenceMinutes
            ? new Date(now.getTime() + policy.cadenceMinutes * 60_000)
            : watch.nextScanAt,
      updatedAt: now,
    })
    .where(and(eq(watchlists.userId, userId), eq(watchlists.companyId, companyId)));
  const globalSources = await db
    .select({ id: careerSources.globalSourceId })
    .from(careerSources)
    .where(
      and(
        eq(careerSources.userId, userId),
        eq(careerSources.companyId, companyId),
        eq(careerSources.active, true),
      ),
    );
  await refreshGlobalSourceDemand(
    globalSources.flatMap((source) => (source.id ? [source.id] : [])),
    now,
  );
  return policy;
}
