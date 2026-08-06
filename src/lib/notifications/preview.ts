import "server-only";

import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { jobAnalysisSchema } from "@/ai";
import { db } from "@/db/client";
import {
  globalJobs,
  jobRequirementExtractions,
  notificationPreferences,
  referralRequests,
  userCompanyFollows,
  userJobEligibility,
  userJobQueueStates,
  userRecommendations,
} from "@/db/schema";
import { freshness } from "@/domain/jobs";
import { toPolicy, type NotificationPreferenceInput } from "@/domain/notifications/preferences";
import { evaluateNotificationPolicy } from "@/domain/notifications/policy";
import { loadGlobalPushPreference } from "./preferences";

export async function previewNotificationPolicy(
  userId: string,
  input: NotificationPreferenceInput,
  now = new Date(),
) {
  const { channel } = await loadGlobalPushPreference(userId);
  const since = new Date(now.getTime() - 7 * 24 * 3_600_000);
  const [rows, referrals, overrides] = await Promise.all([
    db
      .select({
        jobId: globalJobs.id,
        organizationId: globalJobs.organizationId,
        lifecycleStatus: globalJobs.lifecycleStatus,
        postedAt: globalJobs.postedAt,
        postedAtConfidence: globalJobs.postedAtConfidence,
        firstSeenAt: globalJobs.firstSeenAt,
        reopenedAt: globalJobs.reopenedAt,
        verifiedAt: globalJobs.verifiedAt,
        band: userRecommendations.band,
        queueStatus: userJobQueueStates.status,
        outcome: userJobEligibility.outcome,
        uncertainFields: userJobEligibility.uncertainFields,
        extraction: jobRequirementExtractions.structuredOutput,
        interested: userCompanyFollows.interested,
      })
      .from(userRecommendations)
      .innerJoin(globalJobs, eq(userRecommendations.jobId, globalJobs.id))
      .innerJoin(userJobEligibility, eq(userRecommendations.eligibilityId, userJobEligibility.id))
      .innerJoin(
        userJobQueueStates,
        and(eq(userJobQueueStates.userId, userId), eq(userJobQueueStates.jobId, globalJobs.id)),
      )
      .leftJoin(
        jobRequirementExtractions,
        eq(userJobEligibility.extractionId, jobRequirementExtractions.id),
      )
      .leftJoin(
        userCompanyFollows,
        and(
          eq(userCompanyFollows.userId, userId),
          eq(userCompanyFollows.organizationId, globalJobs.organizationId),
        ),
      )
      .where(
        and(
          eq(userRecommendations.userId, userId),
          eq(userRecommendations.active, true),
          gte(userRecommendations.recommendedAt, since),
          isNotNull(globalJobs.verifiedAt),
        ),
      )
      .limit(1_000),
    db
      .select({ organizationId: referralRequests.organizationId })
      .from(referralRequests)
      .where(
        and(
          eq(referralRequests.userId, userId),
          inArray(referralRequests.status, ["available", "requested", "agreed", "submitted"]),
        ),
      ),
    db
      .select({
        organizationId: notificationPreferences.organizationId,
        mode: notificationPreferences.companyOverrideMode,
      })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.channelId, channel.id),
          isNotNull(notificationPreferences.organizationId),
        ),
      ),
  ]);
  const referralOrganizations = new Set(referrals.map((row) => row.organizationId));
  const overrideByOrganization = new Map(
    overrides.flatMap((row) =>
      row.organizationId ? [[row.organizationId, row.mode] as const] : [],
    ),
  );
  const policy = toPolicy(input);
  const reasons: Record<string, number> = {};
  const suppressed: Record<string, number> = {};
  let estimatedAlerts = 0;
  for (const row of rows) {
    const current = freshness(
      now,
      row.postedAt,
      row.postedAtConfidence,
      row.firstSeenAt,
      row.reopenedAt,
    );
    const extraction = jobAnalysisSchema.safeParse(row.extraction);
    const decision = evaluateNotificationPolicy(
      {
        officiallyVerified: Boolean(row.verifiedAt),
        lifecycleStatus: row.lifecycleStatus,
        eligibilityOutcome: row.outcome,
        uncertainFields: row.uncertainFields,
        queueStatus: row.queueStatus,
        band: row.band,
        roleFamily: extraction.success ? extraction.data.roleFamily.value : "other",
        freshnessAgeHours: current.ageHours,
        freshnessBasis: current.basis,
        timestampReliable: current.basis !== "first_seen",
        hasActiveReferral: referralOrganizations.has(row.organizationId),
        interestedCompany: row.interested ?? false,
        companyOverrideMode: overrideByOrganization.get(row.organizationId) ?? null,
        alreadyAlerted: false,
      },
      policy,
      now,
    );
    const target = decision.eligible ? reasons : suppressed;
    target[decision.reason] = (target[decision.reason] ?? 0) + 1;
    if (decision.eligible) estimatedAlerts += 1;
  }
  return {
    lookbackDays: 7,
    evaluatedJobs: rows.length,
    estimatedAlerts,
    reasons,
    suppressed,
    approximate: true,
    generatedAt: now.toISOString(),
  };
}
