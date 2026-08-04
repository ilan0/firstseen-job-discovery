import "server-only";

import { and, eq } from "drizzle-orm";
import {
  AI_ANALYSIS_SCHEMA_VERSION,
  ESCALATION_EXTRACTION_MODEL,
  ROUTINE_EXTRACTION_MODEL,
  analyzeJob,
  jobAnalysisPromptHash,
  jobAnalysisSchema,
  unresolvedEscalationFields,
  type AnalysisResult,
  type JobAnalysis,
} from "@/ai";
import type { NormalizedListing } from "@/connectors/types";
import { db } from "@/db/client";
import { jobRequirementExtractions } from "@/db/schema";
import {
  releaseAiBudget,
  reserveAiBudget,
  reserveAiEscalationBudget,
  settleAiBudget,
} from "@/lib/ai/budget";

export const SHARED_EXTRACTION_VERSION = "shared-requirements-v1";

export type SharedRequirementExtraction = {
  id: string | null;
  analysis: JobAnalysis | null;
  status: "succeeded" | "failed" | "budget_blocked";
  model: string;
  errorCode: string | null;
  unresolvedFields: string[];
};

function safeErrorCode(error: unknown) {
  return error instanceof Error
    ? error.name
        .replace(/[^A-Za-z0-9_]/g, "_")
        .toUpperCase()
        .slice(0, 80) || "AI_FAILED"
    : "AI_FAILED";
}

function extractionConfidence(analysis: JobAnalysis) {
  const score = (value: "low" | "medium" | "high") =>
    value === "high" ? 95 : value === "medium" ? 72 : 45;
  return Math.min(
    score(analysis.employment.confidence),
    score(analysis.clearance.confidence),
    score(analysis.publicTrust.confidence),
    score(analysis.sponsorship.confidence),
    score(analysis.workArrangement.confidence),
    score(analysis.locations.confidence),
    ...analysis.experienceRequirements.map((requirement) => score(requirement.confidence)),
  );
}

function storedExtraction(row: typeof jobRequirementExtractions.$inferSelect) {
  const parsed = jobAnalysisSchema.safeParse(row.structuredOutput);
  return {
    id: row.id,
    analysis: parsed.success ? parsed.data : null,
    status:
      row.status === "succeeded" && parsed.success
        ? ("succeeded" as const)
        : row.status === "budget_blocked"
          ? ("budget_blocked" as const)
          : ("failed" as const),
    model: row.model,
    errorCode: row.errorCode,
    unresolvedFields: row.unresolvedFields,
  };
}

function neutralEscalationReasons(analysis: JobAnalysis) {
  const hardConfidences = [
    analysis.employment.confidence,
    analysis.clearance.confidence,
    analysis.publicTrust.confidence,
    analysis.sponsorship.confidence,
    analysis.workArrangement.confidence,
    analysis.locations.confidence,
    ...analysis.experienceRequirements.map((requirement) => requirement.confidence),
  ];
  const reasons: string[] = [];
  if (hardConfidences.some((confidence) => confidence === "low" || confidence === "medium"))
    reasons.push("low_confidence_hard_field");
  if (analysis.experienceRequirements.some((requirement) => requirement.alternativePath))
    reasons.push("complex_alternative_path");
  if (
    analysis.extractionWarnings.some((warning) =>
      /contradict|conflict|ambiguous|uncertain/i.test(warning),
    )
  )
    reasons.push("contradictory_language");
  return reasons;
}

export type SharedRequirementExtractionOptions = {
  snapshotId: string;
  budgetUserId: string;
  listing: NormalizedListing;
};

type SharedExtractionPreparation =
  | { status: "complete"; extraction: SharedRequirementExtraction }
  | { status: "ready"; reservationId: string; promptHash: string };

type SharedEscalationPreparation =
  | { status: "not_needed" | "budget_blocked"; reasons: string[] }
  | { status: "ready"; reasons: string[]; reservationId: string };

type SharedEscalationOutcome =
  | { status: "not_run" }
  | { status: "succeeded"; reservationId: string; reasons: string[]; result: AnalysisResult }
  | { status: "failed"; reservationId: string; reasons: string[]; errorCode: string };

type DurableStep = <T>(name: string, operation: () => Promise<T>) => Promise<T>;

function extractionCacheWhere(snapshotId: string, promptHash: string) {
  return and(
    eq(jobRequirementExtractions.snapshotId, snapshotId),
    eq(jobRequirementExtractions.model, ROUTINE_EXTRACTION_MODEL),
    eq(jobRequirementExtractions.schemaVersion, AI_ANALYSIS_SCHEMA_VERSION),
    eq(jobRequirementExtractions.promptHash, promptHash),
    eq(jobRequirementExtractions.extractionVersion, SHARED_EXTRACTION_VERSION),
  );
}

async function loadStoredExtraction(snapshotId: string, promptHash: string) {
  const [row] = await db
    .select()
    .from(jobRequirementExtractions)
    .where(extractionCacheWhere(snapshotId, promptHash))
    .limit(1);
  return row ? storedExtraction(row) : null;
}

async function saveNonSucceededExtraction(options: {
  snapshotId: string;
  status: "failed" | "budget_blocked";
  promptHash: string;
  errorCode: string;
}) {
  const [saved] = await db
    .insert(jobRequirementExtractions)
    .values({
      snapshotId: options.snapshotId,
      status: options.status,
      model: ROUTINE_EXTRACTION_MODEL,
      schemaVersion: AI_ANALYSIS_SCHEMA_VERSION,
      promptHash: options.promptHash,
      extractionVersion: SHARED_EXTRACTION_VERSION,
      errorCode: options.errorCode,
      completedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        jobRequirementExtractions.snapshotId,
        jobRequirementExtractions.model,
        jobRequirementExtractions.schemaVersion,
        jobRequirementExtractions.promptHash,
        jobRequirementExtractions.extractionVersion,
      ],
      set: {
        status: options.status,
        structuredOutput: null,
        confidence: null,
        errorCode: options.errorCode,
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();
  return saved
    ? storedExtraction(saved)
    : (await loadStoredExtraction(options.snapshotId, options.promptHash))!;
}

export async function loadSharedRequirements(snapshotId: string) {
  const stored = await loadStoredExtraction(snapshotId, jobAnalysisPromptHash());
  return stored?.status === "succeeded" ? stored : null;
}

async function prepareSharedRequirementExtraction(
  options: SharedRequirementExtractionOptions,
): Promise<SharedExtractionPreparation> {
  const promptHash = jobAnalysisPromptHash();
  const cached = await loadStoredExtraction(options.snapshotId, promptHash);
  if (cached?.status === "succeeded") return { status: "complete", extraction: cached };

  const reservationKey = `openai:global:${options.snapshotId}:${AI_ANALYSIS_SCHEMA_VERSION}:${promptHash}`;
  const reservationId = await reserveAiBudget(options.budgetUserId, reservationKey, 0.004);
  if (!reservationId) {
    const extraction = await saveNonSucceededExtraction({
      snapshotId: options.snapshotId,
      status: "budget_blocked",
      promptHash,
      errorCode: "MONTHLY_BUDGET_LIMIT",
    });
    return { status: "complete", extraction };
  }
  return { status: "ready", reservationId, promptHash };
}

async function runRoutineExtraction(
  listing: NormalizedListing,
  reservationId: string,
): Promise<AnalysisResult> {
  return analyzeJob(
    {
      title: listing.title,
      description: listing.descriptionText,
      employmentType: listing.employmentType,
      locations: listing.locations,
      workplaceType: listing.workplaceType,
    },
    {
      model: ROUTINE_EXTRACTION_MODEL,
      clientRequestId: `firstseen-routine-${reservationId}`,
    },
  );
}

async function prepareSharedEscalation(options: {
  budgetUserId: string;
  snapshotId: string;
  promptHash: string;
  reservationId: string;
  routine: AnalysisResult;
}): Promise<SharedEscalationPreparation> {
  await settleAiBudget(options.reservationId, options.routine.estimatedCostUsd, {
    scope: "global_requirement_extraction",
    model: options.routine.model,
    responseId: options.routine.responseId,
    ...options.routine.usage,
  });
  const reasons = neutralEscalationReasons(options.routine.analysis);
  if (!reasons.length) return { status: "not_needed", reasons };
  const reservationId = await reserveAiEscalationBudget(
    options.budgetUserId,
    `openai:global-escalation:${options.snapshotId}:${AI_ANALYSIS_SCHEMA_VERSION}:${options.promptHash}`,
  );
  return reservationId
    ? { status: "ready", reasons, reservationId }
    : { status: "budget_blocked", reasons };
}

async function runEscalationExtraction(
  listing: NormalizedListing,
  reservationId: string,
): Promise<AnalysisResult> {
  return analyzeJob(
    {
      title: listing.title,
      description: listing.descriptionText,
      employmentType: listing.employmentType,
      locations: listing.locations,
      workplaceType: listing.workplaceType,
    },
    {
      model: ESCALATION_EXTRACTION_MODEL,
      validationAttempts: 1,
      clientRequestId: `firstseen-escalation-${reservationId}`,
    },
  );
}

async function persistSuccessfulSharedExtraction(options: {
  snapshotId: string;
  promptHash: string;
  routine: AnalysisResult;
  escalation: SharedEscalationOutcome;
}) {
  let analysis = options.routine.analysis;
  let escalationModel: string | null = null;
  let unresolvedFields: string[] = [];
  let totalCost = options.routine.estimatedCostUsd;
  let totalLatencyMs = options.routine.latencyMs;
  const totalUsage = { ...options.routine.usage };

  if (options.escalation.status === "succeeded") {
    const terra = options.escalation.result;
    unresolvedFields = unresolvedEscalationFields(options.routine.analysis, terra.analysis);
    analysis = terra.analysis;
    escalationModel = terra.model;
    totalUsage.inputTokens += terra.usage.inputTokens;
    totalUsage.cachedInputTokens += terra.usage.cachedInputTokens;
    totalUsage.outputTokens += terra.usage.outputTokens;
    totalCost += terra.estimatedCostUsd;
    totalLatencyMs += terra.latencyMs;
    await settleAiBudget(options.escalation.reservationId, terra.estimatedCostUsd, {
      scope: "global_requirement_escalation",
      model: terra.model,
      responseId: terra.responseId,
      reasons: options.escalation.reasons,
      unresolvedFields,
      ...terra.usage,
    });
  } else if (options.escalation.status === "failed") {
    await releaseAiBudget(options.escalation.reservationId, options.escalation.errorCode);
  }

  const [saved] = await db
    .insert(jobRequirementExtractions)
    .values({
      snapshotId: options.snapshotId,
      status: "succeeded",
      model: options.routine.model,
      escalationModel,
      unresolvedFields,
      schemaVersion: options.routine.schemaVersion,
      promptHash: options.routine.promptHash,
      extractionVersion: SHARED_EXTRACTION_VERSION,
      structuredOutput: analysis,
      confidence: extractionConfidence(analysis),
      inputTokens: totalUsage.inputTokens,
      cachedInputTokens: totalUsage.cachedInputTokens,
      outputTokens: totalUsage.outputTokens,
      estimatedCostUsd: totalCost.toFixed(6),
      actualCostUsd: totalCost.toFixed(6),
      latencyMs: totalLatencyMs,
      completedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        jobRequirementExtractions.snapshotId,
        jobRequirementExtractions.model,
        jobRequirementExtractions.schemaVersion,
        jobRequirementExtractions.promptHash,
        jobRequirementExtractions.extractionVersion,
      ],
      set: {
        status: "succeeded",
        escalationModel,
        unresolvedFields,
        structuredOutput: analysis,
        confidence: extractionConfidence(analysis),
        inputTokens: totalUsage.inputTokens,
        cachedInputTokens: totalUsage.cachedInputTokens,
        outputTokens: totalUsage.outputTokens,
        estimatedCostUsd: totalCost.toFixed(6),
        actualCostUsd: totalCost.toFixed(6),
        latencyMs: totalLatencyMs,
        completedAt: new Date(),
        errorCode: null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return saved
    ? storedExtraction(saved)
    : (await loadStoredExtraction(options.snapshotId, options.promptHash))!;
}

async function persistFailedSharedExtraction(options: {
  snapshotId: string;
  promptHash: string;
  reservationId: string;
  errorCode: string;
}) {
  await releaseAiBudget(options.reservationId, options.errorCode);
  return saveNonSucceededExtraction({
    snapshotId: options.snapshotId,
    status: "failed",
    promptHash: options.promptHash,
    errorCode: options.errorCode,
  });
}

/**
 * Runs model calls in their own durable steps, separate from database writes.
 * An Inngest replay can therefore reuse an accepted provider response instead
 * of issuing the paid call again after a downstream persistence failure.
 */
export async function runSharedRequirementExtractionWorkflow(
  options: SharedRequirementExtractionOptions,
  runStep: DurableStep,
): Promise<SharedRequirementExtraction> {
  const preparation = await runStep("prepare-shared-requirement-extraction", () =>
    prepareSharedRequirementExtraction(options),
  );
  if (preparation.status === "complete") return preparation.extraction;

  const routine = await runStep("call-routine-requirement-model", async () => {
    try {
      return {
        status: "succeeded" as const,
        result: await runRoutineExtraction(options.listing, preparation.reservationId),
      };
    } catch (error) {
      return { status: "failed" as const, errorCode: safeErrorCode(error) };
    }
  });
  if (routine.status === "failed")
    return runStep("persist-routine-requirement-failure", () =>
      persistFailedSharedExtraction({
        snapshotId: options.snapshotId,
        promptHash: preparation.promptHash,
        reservationId: preparation.reservationId,
        errorCode: routine.errorCode,
      }),
    );

  const escalationPreparation = await runStep("prepare-shared-requirement-escalation", () =>
    prepareSharedEscalation({
      budgetUserId: options.budgetUserId,
      snapshotId: options.snapshotId,
      promptHash: preparation.promptHash,
      reservationId: preparation.reservationId,
      routine: routine.result,
    }),
  );
  let escalation: SharedEscalationOutcome = { status: "not_run" };
  if (escalationPreparation.status === "ready")
    escalation = await runStep("call-escalation-requirement-model", async () => {
      try {
        return {
          status: "succeeded" as const,
          reservationId: escalationPreparation.reservationId,
          reasons: escalationPreparation.reasons,
          result: await runEscalationExtraction(
            options.listing,
            escalationPreparation.reservationId,
          ),
        };
      } catch (error) {
        return {
          status: "failed" as const,
          reservationId: escalationPreparation.reservationId,
          reasons: escalationPreparation.reasons,
          errorCode: safeErrorCode(error),
        };
      }
    });

  return runStep("persist-shared-requirement-extraction", () =>
    persistSuccessfulSharedExtraction({
      snapshotId: options.snapshotId,
      promptHash: preparation.promptHash,
      routine: routine.result,
      escalation,
    }),
  );
}

/**
 * Direct orchestration for focused tests and non-worker callers. Production
 * workers pass Inngest's durable step runner to the workflow above.
 */
export async function extractSharedRequirements(
  options: SharedRequirementExtractionOptions,
): Promise<SharedRequirementExtraction> {
  return runSharedRequirementExtractionWorkflow(options, (_name, operation) => operation());
}
