import "server-only";
import { and, desc, eq } from "drizzle-orm";
import {
  analyzeJob,
  AI_ANALYSIS_SCHEMA_VERSION,
  ESCALATION_EXTRACTION_MODEL,
  escalationReasons,
  jobAnalysisSchema,
  jobAnalysisPromptHash,
  ROUTINE_EXTRACTION_MODEL,
  unresolvedEscalationFields,
  type JobAnalysis,
} from "@/ai";
import type { NormalizedListing } from "@/connectors/types";
import { db } from "@/db/client";
import {
  aiAnalyses,
  eligibilityDecisions,
  jobDescriptionSnapshots,
  queueStateHistory,
  queueStates,
  rankingDimensions,
  recommendations,
} from "@/db/schema";
import {
  ELIGIBILITY_RULE_VERSION,
  evaluateEligibility,
  extractDeterministicFacts,
  isPotentialSoftwareRole,
  mergeAiFacts,
  type EligibilityDecision,
} from "@/domain/eligibility";
import { rankJob, RANKING_VERSION } from "@/domain/ranking";
import {
  releaseAiBudget,
  reserveAiBudget,
  reserveAiEscalationBudget,
  settleAiBudget,
} from "@/lib/ai/budget";
import { loadCandidateRuntime } from "@/lib/candidate/runtime";
import type { IngestResult } from "./ingest";
import { freshness } from "@/domain/jobs";

function confidence(value: "low" | "medium" | "high"): number {
  return value === "high" ? 95 : value === "medium" ? 72 : 45;
}
function errorCode(error: unknown): string {
  if (error instanceof Error && error.name)
    return error.name
      .replace(/[^A-Za-z0-9_]/g, "_")
      .toUpperCase()
      .slice(0, 80);
  return "AI_ANALYSIS_FAILED";
}

function normalizedSkill(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#.]/g, "");
}

function candidateFitExplanations(analysis: JobAnalysis | null, candidateSkills: string[]) {
  if (!analysis) return { strengths: [] as string[], weaknesses: [] as string[] };
  const normalizedCandidate = candidateSkills.map((skill) => ({
    skill,
    normalized: normalizedSkill(skill),
  }));
  const match = (requirement: string) => {
    const normalizedRequirement = normalizedSkill(requirement);
    return normalizedCandidate.find(
      (candidate) =>
        candidate.normalized === normalizedRequirement ||
        (candidate.normalized.length >= 2 &&
          normalizedRequirement.includes(candidate.normalized)) ||
        (normalizedRequirement.length >= 3 && candidate.normalized.includes(normalizedRequirement)),
    )?.skill;
  };
  const strengths = analysis.requiredSkills
    .map((requirement) => {
      const candidate = match(requirement);
      return candidate ? `${candidate} aligns with the listed ${requirement} requirement.` : null;
    })
    .filter((value): value is string => Boolean(value))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 8);
  const weaknesses = analysis.requiredSkills
    .filter((requirement) => !match(requirement))
    .map(
      (requirement) => `${requirement} is listed as required but is not explicit in the profile.`,
    )
    .slice(0, 8);
  return { strengths, weaknesses };
}

export async function analyzeAndRankListing(options: {
  userId: string;
  listing: NormalizedListing;
  ingest: IngestResult;
  hasReferral: boolean;
  sourceConfidence?: number;
  now?: Date;
  sharedExtraction?: {
    analysis: JobAnalysis | null;
    status: "succeeded" | "failed" | "budget_blocked";
    model: string;
    errorCode: string | null;
    unresolvedFields: string[];
  };
}) {
  const now = options.now ?? new Date();
  const runtime = await loadCandidateRuntime(options.userId);
  const eligibilityPolicy = {
    fullTimeOnly: runtime.fullTimeOnly,
    eligibleRequiredYearsMax: runtime.eligibleRequiredYearsMax,
    rejectClearance: runtime.rejectClearance,
    rejectPublicTrust: runtime.rejectPublicTrust,
    needsUsSponsorship: runtime.needsUsSponsorship,
  };
  const promptHash = jobAnalysisPromptHash();
  let snapshotId = options.ingest.snapshotId;
  if (!snapshotId) {
    const [snapshot] = await db
      .select({ id: jobDescriptionSnapshots.id })
      .from(jobDescriptionSnapshots)
      .where(
        and(
          eq(jobDescriptionSnapshots.userId, options.userId),
          eq(jobDescriptionSnapshots.jobId, options.ingest.jobId),
        ),
      )
      .orderBy(desc(jobDescriptionSnapshots.capturedAt))
      .limit(1);
    if (!snapshot) return { state: "unchanged" as const };
    snapshotId = snapshot.id;
  }
  if (!options.ingest.changed && !options.ingest.reopened) {
    const [current] = await db
      .select({ id: recommendations.id })
      .from(recommendations)
      .innerJoin(
        eligibilityDecisions,
        eq(recommendations.eligibilityDecisionId, eligibilityDecisions.id),
      )
      .where(
        and(
          eq(recommendations.userId, options.userId),
          eq(recommendations.jobId, options.ingest.jobId),
          eq(recommendations.snapshotId, snapshotId),
          eq(recommendations.rankingVersion, RANKING_VERSION),
          eq(recommendations.active, true),
          eq(eligibilityDecisions.ruleVersion, ELIGIBILITY_RULE_VERSION),
        ),
      )
      .limit(1);
    if (current) return { state: "unchanged" as const };
  }
  const locationPolicy = {
    acceptedAreas: runtime.acceptedAreas,
    allowFullyRemote: runtime.allowFullyRemote,
  };
  const deterministic = extractDeterministicFacts(
    {
      title: options.listing.title,
      description: options.listing.descriptionText,
      employmentType: options.listing.employmentType,
      locations: options.listing.locations,
      workplaceType: options.listing.workplaceType,
    },
    locationPolicy,
  );
  const preliminary = evaluateEligibility(deterministic, eligibilityPolicy);
  let finalDecision: EligibilityDecision = preliminary;
  let analysis: JobAnalysis | null = null;
  let analysisStatus: "succeeded" | "failed" | "budget_blocked" = "succeeded";
  let analysisError: string | null = null;
  let model = ROUTINE_EXTRACTION_MODEL;
  let usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number } | null = null;
  let cost = 0;
  let latencyMs: number | null = null;

  const potentialSoftwareRole = isPotentialSoftwareRole(options.listing.title);
  if (preliminary.outcome !== "ineligible" && potentialSoftwareRole) {
    if (options.sharedExtraction) {
      analysis = options.sharedExtraction.analysis;
      analysisStatus = options.sharedExtraction.status;
      analysisError = options.sharedExtraction.errorCode;
      model = `shared:${options.sharedExtraction.model}`;
      finalDecision = analysis
        ? evaluateEligibility(
            mergeAiFacts(deterministic, analysis, locationPolicy),
            eligibilityPolicy,
          )
        : {
            ...preliminary,
            outcome: "review",
            uncertainFields: [
              ...new Set([
                ...preliminary.uncertainFields,
                options.sharedExtraction.status === "budget_blocked"
                  ? "ai_analysis_budget"
                  : "ai_analysis",
              ]),
            ],
          };
      if (analysis && options.sharedExtraction.unresolvedFields.length) {
        finalDecision = {
          ...finalDecision,
          outcome: "review",
          uncertainFields: [
            ...new Set([
              ...finalDecision.uncertainFields,
              ...options.sharedExtraction.unresolvedFields,
            ]),
          ],
        };
      }
    } else {
      const [cached] = await db
        .select()
        .from(aiAnalyses)
        .where(
          and(
            eq(aiAnalyses.userId, options.userId),
            eq(aiAnalyses.snapshotId, snapshotId),
            eq(aiAnalyses.schemaVersion, AI_ANALYSIS_SCHEMA_VERSION),
            eq(aiAnalyses.promptHash, promptHash),
          ),
        )
        .limit(1);
      const cachedAnalysis = jobAnalysisSchema.safeParse(cached?.structuredOutput);
      if (cached?.status === "succeeded" && cachedAnalysis.success) {
        analysis = cachedAnalysis.data;
        model = cached.model;
        finalDecision = evaluateEligibility(
          mergeAiFacts(deterministic, analysis, locationPolicy),
          eligibilityPolicy,
        );
      } else if (cached) {
        analysisStatus = cached.status === "budget_blocked" ? "budget_blocked" : "failed";
        analysisError = cached.errorCode ?? "AI_ANALYSIS_UNAVAILABLE";
        finalDecision = {
          ...preliminary,
          outcome: "review",
          uncertainFields: [...new Set([...preliminary.uncertainFields, "ai_analysis"])],
        };
      } else {
        const reservationKey = `openai:${snapshotId}:${AI_ANALYSIS_SCHEMA_VERSION}:${promptHash}`;
        const reservationId = await reserveAiBudget(options.userId, reservationKey);
        if (!reservationId) {
          analysisStatus = "budget_blocked";
          analysisError = "MONTHLY_BUDGET_LIMIT";
          finalDecision = {
            ...preliminary,
            outcome: "review",
            uncertainFields: [...new Set([...preliminary.uncertainFields, "ai_analysis_budget"])],
          };
        } else {
          try {
            const result = await analyzeJob(
              {
                title: options.listing.title,
                description: options.listing.descriptionText,
                employmentType: options.listing.employmentType,
                locations: options.listing.locations,
                workplaceType: options.listing.workplaceType,
              },
              { model: ROUTINE_EXTRACTION_MODEL },
            );
            analysis = result.analysis;
            model = result.model;
            usage = result.usage;
            cost = result.estimatedCostUsd;
            latencyMs = result.latencyMs;
            finalDecision = evaluateEligibility(
              mergeAiFacts(deterministic, analysis, locationPolicy),
              eligibilityPolicy,
            );
            await settleAiBudget(reservationId, cost, { model, ...usage });
            const currentFreshness = freshness(
              now,
              options.ingest.postedAt,
              options.ingest.postedAtConfidence,
              options.ingest.firstSeenAt,
              options.ingest.reopenedAt,
            );
            const reasons = escalationReasons({
              deterministic,
              analysis,
              decisionOutcome: finalDecision.outcome,
              hasReferral: options.hasReferral,
              freshnessAgeHours: currentFreshness.ageHours,
            });
            if (reasons.length) {
              const escalationKey = `openai-escalation:${snapshotId}:${AI_ANALYSIS_SCHEMA_VERSION}:${promptHash}`;
              const escalationReservation = await reserveAiEscalationBudget(
                options.userId,
                escalationKey,
              );
              if (escalationReservation) {
                try {
                  const terra = await analyzeJob(
                    {
                      title: options.listing.title,
                      description: options.listing.descriptionText,
                      employmentType: options.listing.employmentType,
                      locations: options.listing.locations,
                      workplaceType: options.listing.workplaceType,
                    },
                    { model: ESCALATION_EXTRACTION_MODEL, validationAttempts: 1 },
                  );
                  const unresolved = unresolvedEscalationFields(analysis, terra.analysis);
                  analysis = terra.analysis;
                  model = `${ROUTINE_EXTRACTION_MODEL}+${ESCALATION_EXTRACTION_MODEL}`;
                  usage = {
                    inputTokens: usage.inputTokens + terra.usage.inputTokens,
                    cachedInputTokens: usage.cachedInputTokens + terra.usage.cachedInputTokens,
                    outputTokens: usage.outputTokens + terra.usage.outputTokens,
                  };
                  cost += terra.estimatedCostUsd;
                  latencyMs = (latencyMs ?? 0) + terra.latencyMs;
                  finalDecision = evaluateEligibility(
                    mergeAiFacts(deterministic, analysis, locationPolicy),
                    eligibilityPolicy,
                  );
                  if (unresolved.length) {
                    finalDecision = {
                      ...finalDecision,
                      outcome: "review",
                      uncertainFields: [
                        ...new Set([...finalDecision.uncertainFields, ...unresolved]),
                      ],
                    };
                  }
                  await settleAiBudget(escalationReservation, terra.estimatedCostUsd, {
                    model: terra.model,
                    reasons,
                    unresolved,
                    ...terra.usage,
                  });
                } catch (error) {
                  await releaseAiBudget(escalationReservation, errorCode(error));
                }
              }
            }
          } catch (error) {
            analysisStatus = "failed";
            analysisError = errorCode(error);
            finalDecision = {
              ...preliminary,
              outcome: "review",
              uncertainFields: [...new Set([...preliminary.uncertainFields, "ai_analysis"])],
            };
            await releaseAiBudget(reservationId, analysisError);
          }
        }
      }
    }
  }
  if (!potentialSoftwareRole) model = "deterministic-skip";

  const roleFamily = analysis?.roleFamily.value ?? finalDecision.facts.roleFamily.value;
  const extractionConfidence = analysis
    ? Math.min(
        confidence(analysis.employment.confidence),
        confidence(analysis.roleFamily.confidence),
        confidence(analysis.locations.confidence),
      )
    : 45;
  const recommendation = rankJob({
    title: options.listing.title,
    eligibility: finalDecision,
    roleFamily,
    requiredSkills: analysis?.requiredSkills ?? [],
    preferredSkills: analysis?.preferredSkills ?? [],
    candidateSkills: runtime.candidateSkills,
    rolePriorities: runtime.rolePriorities,
    postedAt: options.ingest.postedAt,
    firstSeenAt: options.ingest.firstSeenAt,
    reopenedAt: options.ingest.reopenedAt,
    now,
    reliablePostedAt: options.ingest.postedAtConfidence !== "low",
    hasReferral: options.hasReferral,
    sourceConfidence: options.sourceConfidence ?? confidence(options.listing.sourceConfidence),
    extractionConfidence,
  });
  const fitExplanations = candidateFitExplanations(analysis, runtime.candidateSkills);

  await db.transaction(async (tx) => {
    const [decision] = await tx
      .insert(eligibilityDecisions)
      .values({
        userId: options.userId,
        jobId: options.ingest.jobId,
        snapshotId,
        outcome: finalDecision.outcome,
        ruleVersion: ELIGIBILITY_RULE_VERSION,
        normalizedFacts: finalDecision.facts,
        reasons: finalDecision.reasons,
        evidence: finalDecision.reasons.flatMap((reason) => reason.evidence),
        uncertainFields: finalDecision.uncertainFields,
      })
      .onConflictDoUpdate({
        target: [eligibilityDecisions.snapshotId, eligibilityDecisions.ruleVersion],
        set: {
          outcome: finalDecision.outcome,
          normalizedFacts: finalDecision.facts,
          reasons: finalDecision.reasons,
          evidence: finalDecision.reasons.flatMap((reason) => reason.evidence),
          uncertainFields: finalDecision.uncertainFields,
          evaluatedAt: now,
          updatedAt: now,
        },
      })
      .returning({ id: eligibilityDecisions.id });
    if (!decision) throw new Error("Eligibility decision could not be saved");
    await tx
      .insert(aiAnalyses)
      .values({
        userId: options.userId,
        jobId: options.ingest.jobId,
        snapshotId,
        status: preliminary.outcome === "ineligible" ? "succeeded" : analysisStatus,
        model,
        schemaVersion: AI_ANALYSIS_SCHEMA_VERSION,
        promptHash,
        structuredOutput: analysis,
        errorCode: analysisError,
        inputTokens: usage?.inputTokens,
        cachedInputTokens: usage?.cachedInputTokens,
        outputTokens: usage?.outputTokens,
        estimatedCostUsd: cost.toFixed(6),
        latencyMs,
        completedAt: now,
      })
      .onConflictDoUpdate({
        target: [aiAnalyses.snapshotId, aiAnalyses.schemaVersion, aiAnalyses.promptHash],
        set: {
          status: preliminary.outcome === "ineligible" ? "succeeded" : analysisStatus,
          // A deterministic policy update can make an unchanged listing ineligible
          // without running AI. Preserve a previously validated extraction so a
          // later policy revision can safely reuse it instead of paying to analyze
          // identical content again.
          structuredOutput: analysis ?? aiAnalyses.structuredOutput,
          errorCode: analysisError,
          completedAt: now,
          updatedAt: now,
        },
      });
    await tx
      .update(recommendations)
      .set({ active: false, updatedAt: now })
      .where(
        and(
          eq(recommendations.userId, options.userId),
          eq(recommendations.jobId, options.ingest.jobId),
          eq(recommendations.active, true),
        ),
      );
    for (const item of recommendation.dimensions)
      await tx
        .insert(rankingDimensions)
        .values({
          userId: options.userId,
          jobId: options.ingest.jobId,
          snapshotId,
          dimension: item.dimension,
          value: item.value,
          confidence: item.confidence,
          evidence: item.evidence,
          explanation: item.explanation,
          rankingVersion: recommendation.version,
        })
        .onConflictDoUpdate({
          target: [
            rankingDimensions.snapshotId,
            rankingDimensions.dimension,
            rankingDimensions.rankingVersion,
          ],
          set: {
            value: item.value,
            confidence: item.confidence,
            evidence: item.evidence,
            explanation: item.explanation,
            updatedAt: now,
          },
        });
    const [savedRecommendation] = await tx
      .insert(recommendations)
      .values({
        userId: options.userId,
        jobId: options.ingest.jobId,
        snapshotId,
        eligibilityDecisionId: decision.id,
        band: recommendation.band,
        urgency: recommendation.urgency,
        headline: recommendation.headline,
        strengths: fitExplanations.strengths,
        weaknesses: fitExplanations.weaknesses,
        routingReasons: recommendation.routingReasons,
        rankingVersion: recommendation.version,
        active: true,
        recommendedAt: now,
      })
      .onConflictDoUpdate({
        target: [recommendations.snapshotId, recommendations.rankingVersion],
        set: {
          eligibilityDecisionId: decision.id,
          band: recommendation.band,
          urgency: recommendation.urgency,
          headline: recommendation.headline,
          strengths: fitExplanations.strengths,
          weaknesses: fitExplanations.weaknesses,
          routingReasons: recommendation.routingReasons,
          active: true,
          updatedAt: now,
        },
      })
      .returning({ id: recommendations.id });
    if (recommendation.band !== "not_recommended") {
      const [state] = await tx
        .insert(queueStates)
        .values({ userId: options.userId, jobId: options.ingest.jobId, status: "active" })
        .onConflictDoNothing()
        .returning({ id: queueStates.id });
      if (state)
        await tx.insert(queueStateHistory).values({
          userId: options.userId,
          jobId: options.ingest.jobId,
          fromStatus: null,
          toStatus: "active",
          reason: "New recommendation",
        });
    }
    return savedRecommendation;
  });
  return { state: "analyzed" as const, recommendation, decision: finalDecision, analysisStatus };
}
