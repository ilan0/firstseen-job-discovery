import { describe, expect, it } from "vitest";
import { evaluationGates, scoreAiEvaluation } from "./evaluation";
import type { JobAnalysis } from "./schema";

function analysis(overrides: Partial<JobAnalysis> = {}): JobAnalysis {
  return {
    employment: { value: "full_time", confidence: "high", evidence: [] },
    experienceRequirements: [],
    clearance: { value: "not_mentioned", confidence: "high", evidence: [] },
    publicTrust: { value: "not_mentioned", confidence: "high", evidence: [] },
    sponsorship: { value: "not_mentioned", confidence: "high", evidence: [] },
    workArrangement: { value: "fully_remote", confidence: "high", evidence: [] },
    locations: { value: ["United States"], confidence: "high", evidence: [] },
    roleFamily: { value: "general_swe", confidence: "high", evidence: [] },
    requiredSkills: [],
    preferredSkills: [],
    candidateStrengths: [],
    candidateWeaknesses: [],
    summary: "Fixture",
    extractionWarnings: [],
    ...overrides,
  };
}

describe("versioned AI evaluation metrics", () => {
  it("scores hard exclusions, ambiguity routing, experience kind, and evidence separately", () => {
    const required = {
      text: "3 years required",
      kind: "required" as const,
      minimumYears: 3,
      maximumYears: null,
      alternativePath: false,
      confidence: "high" as const,
      evidence: [],
    };
    const metrics = scoreAiEvaluation([
      {
        expected: { hardOutcome: "eligible", experienceKinds: [] },
        analysis: analysis(),
        evidenceValid: true,
      },
      {
        expected: {
          hardOutcome: "ineligible",
          experienceKinds: [{ kind: "required", minimumYears: 3, maximumYears: null }],
        },
        analysis: analysis({ experienceRequirements: [required] }),
        evidenceValid: true,
      },
      {
        expected: { hardOutcome: "review", experienceKinds: [] },
        analysis: analysis({
          clearance: { value: "uncertain", confidence: "low", evidence: [] },
        }),
        evidenceValid: true,
      },
    ]);
    expect(metrics).toMatchObject({
      caseCount: 3,
      hardExclusionRecall: 1,
      hardExclusionPrecision: 1,
      requiredPreferredF1: 1,
      reviewRoutingRecall: 1,
      evidenceValidity: 1,
    });
    expect(evaluationGates(metrics).corpusSize).toBe(false);
  });

  it("counts false recommendations, missed exclusions, experience errors, and invalid evidence", () => {
    const unexpected = {
      text: "One year preferred",
      kind: "preferred" as const,
      minimumYears: 1,
      maximumYears: 1,
      alternativePath: false,
      confidence: "high" as const,
      evidence: [],
    };
    const metrics = scoreAiEvaluation([
      {
        expected: { hardOutcome: "eligible", experienceKinds: [] },
        analysis: analysis({
          employment: { value: "contract", confidence: "high", evidence: [] },
          experienceRequirements: [unexpected],
        }),
        evidenceValid: false,
      },
      {
        expected: {
          hardOutcome: "ineligible",
          experienceKinds: [{ kind: "required", minimumYears: 3, maximumYears: null }],
        },
        analysis: analysis(),
        evidenceValid: true,
      },
    ]);
    expect(metrics).toMatchObject({
      hardExclusionRecall: 0,
      hardExclusionPrecision: 0,
      requiredPreferredF1: 0,
      evidenceValidity: 0.5,
    });
  });
});
