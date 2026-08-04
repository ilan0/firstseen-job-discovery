import type { JobAnalysis } from "./schema";

export type EvaluationExpectation = {
  hardOutcome: "eligible" | "ineligible" | "review";
  experienceKinds: Array<{
    kind: "required" | "preferred";
    minimumYears: number | null;
    maximumYears: number | null;
  }>;
};

function predictedHardOutcome(analysis: JobAnalysis) {
  if (
    [
      analysis.employment.confidence,
      analysis.clearance.confidence,
      analysis.publicTrust.confidence,
      analysis.sponsorship.confidence,
      analysis.workArrangement.confidence,
      analysis.locations.confidence,
    ].some((value) => value === "low")
  )
    return "review" as const;
  if (
    analysis.employment.value === "unknown" ||
    analysis.clearance.value === "uncertain" ||
    analysis.publicTrust.value === "uncertain" ||
    analysis.sponsorship.value === "uncertain" ||
    analysis.workArrangement.value === "unknown"
  )
    return "review" as const;
  if (
    analysis.employment.value !== "full_time" ||
    analysis.clearance.value === "required" ||
    analysis.publicTrust.value === "required" ||
    analysis.experienceRequirements.some(
      (item) => item.kind === "required" && (item.minimumYears ?? 0) > 2,
    )
  )
    return "ineligible" as const;
  return "eligible" as const;
}

function experienceLabels(values: EvaluationExpectation["experienceKinds"]) {
  return new Set(
    values.map(
      (item) => `${item.kind}:${item.minimumYears ?? "null"}:${item.maximumYears ?? "null"}`,
    ),
  );
}

function ratio(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 1;
}

export function scoreAiEvaluation(
  cases: Array<{
    expected: EvaluationExpectation;
    analysis: JobAnalysis;
    evidenceValid: boolean;
  }>,
) {
  let exclusionTruePositive = 0;
  let exclusionFalsePositive = 0;
  let exclusionFalseNegative = 0;
  let reviewExpected = 0;
  let reviewDetected = 0;
  let experienceTruePositive = 0;
  let experienceFalsePositive = 0;
  let experienceFalseNegative = 0;
  for (const item of cases) {
    const predicted = predictedHardOutcome(item.analysis);
    if (item.expected.hardOutcome === "ineligible" && predicted === "ineligible")
      exclusionTruePositive += 1;
    if (item.expected.hardOutcome !== "ineligible" && predicted === "ineligible")
      exclusionFalsePositive += 1;
    if (item.expected.hardOutcome === "ineligible" && predicted !== "ineligible")
      exclusionFalseNegative += 1;
    if (item.expected.hardOutcome === "review") {
      reviewExpected += 1;
      if (predicted === "review") reviewDetected += 1;
    }
    const expectedExperience = experienceLabels(item.expected.experienceKinds);
    const actualExperience = experienceLabels(item.analysis.experienceRequirements);
    for (const label of actualExperience)
      if (expectedExperience.has(label)) experienceTruePositive += 1;
      else experienceFalsePositive += 1;
    for (const label of expectedExperience)
      if (!actualExperience.has(label)) experienceFalseNegative += 1;
  }
  const exclusionRecall = ratio(
    exclusionTruePositive,
    exclusionTruePositive + exclusionFalseNegative,
  );
  const exclusionPrecision = ratio(
    exclusionTruePositive,
    exclusionTruePositive + exclusionFalsePositive,
  );
  const experiencePrecision = ratio(
    experienceTruePositive,
    experienceTruePositive + experienceFalsePositive,
  );
  const experienceRecall = ratio(
    experienceTruePositive,
    experienceTruePositive + experienceFalseNegative,
  );
  const requiredPreferredF1 =
    experiencePrecision + experienceRecall > 0
      ? (2 * experiencePrecision * experienceRecall) / (experiencePrecision + experienceRecall)
      : experienceFalsePositive + experienceFalseNegative === 0
        ? 1
        : 0;
  return {
    caseCount: cases.length,
    hardExclusionRecall: exclusionRecall,
    hardExclusionPrecision: exclusionPrecision,
    requiredPreferredF1,
    reviewRoutingRecall: ratio(reviewDetected, reviewExpected),
    evidenceValidity: ratio(cases.filter((item) => item.evidenceValid).length, cases.length),
  };
}

export function evaluationGates(metrics: ReturnType<typeof scoreAiEvaluation>) {
  return {
    corpusSize: metrics.caseCount >= 300,
    hardExclusionRecall: metrics.hardExclusionRecall >= 0.995,
    hardExclusionPrecision: metrics.hardExclusionPrecision >= 0.98,
    requiredPreferredF1: metrics.requiredPreferredF1 >= 0.95,
    reviewRoutingRecall: metrics.reviewRoutingRecall >= 0.95,
    evidenceValidity: metrics.evidenceValidity === 1,
  };
}
