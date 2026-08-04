import { describe, expect, it } from "vitest";
import type { ExtractedJobFacts } from "@/domain/eligibility";
import type { JobAnalysis } from "./schema";
import { escalationReasons, unresolvedEscalationFields } from "./escalation";

const fact = <T>(value: T) => ({ value, confidence: "high" as const, evidence: [] });
const deterministic: ExtractedJobFacts = {
  employment: fact("full_time"),
  experienceRequirements: [],
  clearance: fact("not_mentioned"),
  publicTrust: fact("not_mentioned"),
  sponsorship: fact("not_mentioned"),
  workArrangement: fact("fully_remote"),
  locations: fact(["United States"]),
  locationEligibility: fact("eligible"),
  roleFamily: fact("general_swe"),
};
const analysis: JobAnalysis = {
  employment: fact("full_time"),
  experienceRequirements: [],
  clearance: fact("not_mentioned"),
  publicTrust: fact("not_mentioned"),
  sponsorship: fact("not_mentioned"),
  workArrangement: fact("fully_remote"),
  locations: fact(["United States"]),
  roleFamily: fact("general_swe"),
  requiredSkills: [],
  preferredSkills: [],
  candidateStrengths: [],
  candidateWeaknesses: [],
  summary: "Remote full-time SWE role.",
  extractionWarnings: [],
};

describe("AI escalation routing", () => {
  it("routes low confidence, conflicts, alternatives, and fresh referral reviews", () => {
    const reasons = escalationReasons({
      deterministic,
      analysis: {
        ...analysis,
        employment: fact("contract"),
        clearance: { ...fact("uncertain"), confidence: "low" },
        experienceRequirements: [
          {
            text: "Degree or equivalent experience",
            kind: "required",
            minimumYears: null,
            maximumYears: null,
            alternativePath: true,
            confidence: "high",
            evidence: [],
          },
        ],
      },
      decisionOutcome: "review",
      hasReferral: true,
      freshnessAgeHours: 2,
    });
    expect(reasons).toEqual(
      expect.arrayContaining([
        "low_confidence_hard_field",
        "deterministic_ai_conflict",
        "complex_alternative_path",
        "fresh_referral_review",
      ]),
    );
  });

  it("keeps model disagreement reviewable", () => {
    expect(
      unresolvedEscalationFields(analysis, { ...analysis, publicTrust: fact("required") }),
    ).toContain("public_trust");
  });

  it("detects each definitive hard-field conflict and contradictory language", () => {
    const reasons = escalationReasons({
      deterministic,
      analysis: {
        ...analysis,
        clearance: fact("required"),
        publicTrust: fact("required"),
        workArrangement: fact("onsite"),
        extractionWarnings: ["Conflicting and ambiguous location language."],
      },
      decisionOutcome: "eligible",
      hasReferral: false,
      freshnessAgeHours: 100,
    });
    expect(reasons).toEqual(["deterministic_ai_conflict", "contradictory_language"]);
  });

  it("does not escalate unknown-value comparisons or stale non-referral reviews", () => {
    expect(
      escalationReasons({
        deterministic: {
          ...deterministic,
          employment: fact("unknown"),
          clearance: fact("uncertain"),
          publicTrust: fact("not_mentioned"),
          workArrangement: fact("unknown"),
        },
        analysis: {
          ...analysis,
          employment: fact("contract"),
          clearance: fact("required"),
          publicTrust: fact("required"),
          workArrangement: fact("onsite"),
        },
        decisionOutcome: "review",
        hasReferral: true,
        freshnessAgeHours: 25,
      }),
    ).toEqual([]);
  });

  it("reports every candidate-neutral disagreement without inventing agreement", () => {
    const terra: JobAnalysis = {
      ...analysis,
      employment: fact("contract"),
      clearance: fact("required"),
      publicTrust: fact("required"),
      sponsorship: fact("incompatible"),
      workArrangement: fact("onsite"),
      locations: fact(["Miami, FL"]),
      experienceRequirements: [
        {
          text: "Two years required",
          kind: "required",
          minimumYears: 2,
          maximumYears: 2,
          alternativePath: false,
          confidence: "high",
          evidence: [],
        },
      ],
    };
    expect(unresolvedEscalationFields(analysis, terra)).toEqual([
      "employment",
      "clearance",
      "public_trust",
      "sponsorship",
      "work_arrangement",
      "locations",
      "required_experience",
    ]);
    expect(unresolvedEscalationFields(analysis, analysis)).toEqual([]);
  });
});
