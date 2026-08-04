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

/**
 * Extracts candidate-neutral requirements once for a global snapshot. The
 * budget is attributed to one watcher, but no candidate or relationship data
 * is included in the model request.
 */
export async function extractSharedRequirements(options: {
  snapshotId: string;
  budgetUserId: string;
  listing: NormalizedListing;
}): Promise<SharedRequirementExtraction> {
  const promptHash = jobAnalysisPromptHash();
  const cacheWhere = and(
    eq(jobRequirementExtractions.snapshotId, options.snapshotId),
    eq(jobRequirementExtractions.model, ROUTINE_EXTRACTION_MODEL),
    eq(jobRequirementExtractions.schemaVersion, AI_ANALYSIS_SCHEMA_VERSION),
    eq(jobRequirementExtractions.promptHash, promptHash),
    eq(jobRequirementExtractions.extractionVersion, SHARED_EXTRACTION_VERSION),
  );
  const [cached] = await db.select().from(jobRequirementExtractions).where(cacheWhere).limit(1);
  if (cached) {
    const stored = storedExtraction(cached);
    if (stored.status === "succeeded") return stored;
  }

  const reservationKey = `openai:global:${options.snapshotId}:${AI_ANALYSIS_SCHEMA_VERSION}:${promptHash}`;
  const reservationId = await reserveAiBudget(options.budgetUserId, reservationKey, 0.004);
  if (!reservationId) {
    const [saved] = await db
      .insert(jobRequirementExtractions)
      .values({
        snapshotId: options.snapshotId,
        status: "budget_blocked",
        model: ROUTINE_EXTRACTION_MODEL,
        schemaVersion: AI_ANALYSIS_SCHEMA_VERSION,
        promptHash,
        extractionVersion: SHARED_EXTRACTION_VERSION,
        errorCode: "MONTHLY_BUDGET_LIMIT",
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
          status: "budget_blocked",
          structuredOutput: null,
          confidence: null,
          errorCode: "MONTHLY_BUDGET_LIMIT",
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    return saved
      ? storedExtraction(saved)
      : storedExtraction(
          (await db.select().from(jobRequirementExtractions).where(cacheWhere).limit(1))[0]!,
        );
  }

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
    await settleAiBudget(reservationId, result.estimatedCostUsd, {
      scope: "global_requirement_extraction",
      model: result.model,
      ...result.usage,
    });
    let analysis = result.analysis;
    let escalationModel: string | null = null;
    let unresolvedFields: string[] = [];
    let totalCost = result.estimatedCostUsd;
    let totalLatencyMs = result.latencyMs;
    const totalUsage = { ...result.usage };
    const escalationReasons = neutralEscalationReasons(result.analysis);
    if (escalationReasons.length) {
      const escalationReservation = await reserveAiEscalationBudget(
        options.budgetUserId,
        `openai:global-escalation:${options.snapshotId}:${AI_ANALYSIS_SCHEMA_VERSION}:${promptHash}`,
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
          unresolvedFields = unresolvedEscalationFields(result.analysis, terra.analysis);
          analysis = terra.analysis;
          escalationModel = terra.model;
          totalUsage.inputTokens += terra.usage.inputTokens;
          totalUsage.cachedInputTokens += terra.usage.cachedInputTokens;
          totalUsage.outputTokens += terra.usage.outputTokens;
          totalCost += terra.estimatedCostUsd;
          totalLatencyMs += terra.latencyMs;
          await settleAiBudget(escalationReservation, terra.estimatedCostUsd, {
            scope: "global_requirement_escalation",
            model: terra.model,
            reasons: escalationReasons,
            unresolvedFields,
            ...terra.usage,
          });
        } catch (error) {
          await releaseAiBudget(escalationReservation, safeErrorCode(error));
        }
      }
    }
    const [saved] = await db
      .insert(jobRequirementExtractions)
      .values({
        snapshotId: options.snapshotId,
        status: "succeeded",
        model: result.model,
        escalationModel,
        unresolvedFields,
        schemaVersion: result.schemaVersion,
        promptHash: result.promptHash,
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
      : storedExtraction(
          (await db.select().from(jobRequirementExtractions).where(cacheWhere).limit(1))[0]!,
        );
  } catch (error) {
    const errorCode = safeErrorCode(error);
    await releaseAiBudget(reservationId, errorCode);
    const [saved] = await db
      .insert(jobRequirementExtractions)
      .values({
        snapshotId: options.snapshotId,
        status: "failed",
        model: ROUTINE_EXTRACTION_MODEL,
        schemaVersion: AI_ANALYSIS_SCHEMA_VERSION,
        promptHash,
        extractionVersion: SHARED_EXTRACTION_VERSION,
        errorCode,
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
          status: "failed",
          structuredOutput: null,
          confidence: null,
          errorCode,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    return saved
      ? storedExtraction(saved)
      : storedExtraction(
          (await db.select().from(jobRequirementExtractions).where(cacheWhere).limit(1))[0]!,
        );
  }
}
