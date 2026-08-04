import type { ExtractedJobFacts } from "@/domain/eligibility";
import type { JobAnalysis } from "./schema";

export const ROUTINE_EXTRACTION_MODEL = "gpt-5.6-luna";
export const ESCALATION_EXTRACTION_MODEL = "gpt-5.6-terra";

export type EscalationReason =
  | "low_confidence_hard_field"
  | "deterministic_ai_conflict"
  | "complex_alternative_path"
  | "fresh_referral_review"
  | "contradictory_language";

function conflict<T>(deterministic: T, ai: T, unknownValues: T[]) {
  return (
    !unknownValues.includes(deterministic) && !unknownValues.includes(ai) && deterministic !== ai
  );
}

export function escalationReasons(options: {
  deterministic: ExtractedJobFacts;
  analysis: JobAnalysis;
  decisionOutcome: "eligible" | "ineligible" | "review";
  hasReferral: boolean;
  freshnessAgeHours: number;
}): EscalationReason[] {
  const { deterministic, analysis } = options;
  const reasons = new Set<EscalationReason>();
  const hardConfidences = [
    analysis.employment.confidence,
    analysis.clearance.confidence,
    analysis.publicTrust.confidence,
    analysis.sponsorship.confidence,
    analysis.workArrangement.confidence,
    analysis.locations.confidence,
    ...analysis.experienceRequirements.map((requirement) => requirement.confidence),
  ];
  if (hardConfidences.some((confidence) => confidence === "low" || confidence === "medium"))
    reasons.add("low_confidence_hard_field");
  if (
    conflict(deterministic.employment.value, analysis.employment.value, ["unknown"]) ||
    conflict(deterministic.clearance.value, analysis.clearance.value, [
      "uncertain",
      "not_mentioned",
    ]) ||
    conflict(deterministic.publicTrust.value, analysis.publicTrust.value, [
      "uncertain",
      "not_mentioned",
    ]) ||
    conflict(deterministic.workArrangement.value, analysis.workArrangement.value, ["unknown"])
  )
    reasons.add("deterministic_ai_conflict");
  if (analysis.experienceRequirements.some((requirement) => requirement.alternativePath))
    reasons.add("complex_alternative_path");
  if (
    options.decisionOutcome === "review" &&
    options.hasReferral &&
    options.freshnessAgeHours <= 24
  )
    reasons.add("fresh_referral_review");
  if (
    analysis.extractionWarnings.some((warning) =>
      /contradict|conflict|ambiguous|uncertain/i.test(warning),
    )
  )
    reasons.add("contradictory_language");
  return [...reasons];
}

export function unresolvedEscalationFields(luna: JobAnalysis, terra: JobAnalysis): string[] {
  const fields: string[] = [];
  const compare = (field: string, left: unknown, right: unknown) => {
    if (JSON.stringify(left) !== JSON.stringify(right)) fields.push(field);
  };
  compare("employment", luna.employment.value, terra.employment.value);
  compare("clearance", luna.clearance.value, terra.clearance.value);
  compare("public_trust", luna.publicTrust.value, terra.publicTrust.value);
  compare("sponsorship", luna.sponsorship.value, terra.sponsorship.value);
  compare("work_arrangement", luna.workArrangement.value, terra.workArrangement.value);
  compare("locations", luna.locations.value, terra.locations.value);
  compare(
    "required_experience",
    luna.experienceRequirements.filter((item) => item.kind === "required"),
    terra.experienceRequirements.filter((item) => item.kind === "required"),
  );
  return fields;
}
