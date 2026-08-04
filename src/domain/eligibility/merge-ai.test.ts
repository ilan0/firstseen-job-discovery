import { describe, expect, it } from "vitest";
import type { JobAnalysis } from "@/ai";
import { extractDeterministicFacts, mergeAiFacts } from ".";

const emptyEvidence: never[] = [];

function analysis(overrides: Partial<JobAnalysis> = {}): JobAnalysis {
  return {
    employment: { value: "full_time", confidence: "high", evidence: emptyEvidence },
    experienceRequirements: [],
    clearance: { value: "not_mentioned", confidence: "medium", evidence: emptyEvidence },
    publicTrust: { value: "not_mentioned", confidence: "medium", evidence: emptyEvidence },
    sponsorship: { value: "not_mentioned", confidence: "medium", evidence: emptyEvidence },
    workArrangement: { value: "fully_remote", confidence: "high", evidence: emptyEvidence },
    locations: { value: ["Remote - United States"], confidence: "high", evidence: emptyEvidence },
    roleFamily: { value: "general_swe", confidence: "high", evidence: emptyEvidence },
    requiredSkills: [],
    preferredSkills: [],
    candidateStrengths: [],
    candidateWeaknesses: [],
    summary: "Early-career software role.",
    extractionWarnings: [],
    ...overrides,
  };
}

describe("AI fact merge boundary", () => {
  it("fills only unknown deterministic metadata fields", () => {
    const deterministic = extractDeterministicFacts({
      title: "Technology Analyst",
      description: "Build reliable products.",
      employmentType: null,
      locations: [],
      workplaceType: null,
    });
    const merged = mergeAiFacts(deterministic, analysis());

    expect(merged.employment.value).toBe("full_time");
    expect(merged.workArrangement.value).toBe("fully_remote");
    expect(merged.locations.value).toEqual(["Remote - United States"]);
    expect(merged.locationEligibility.value).toBe("eligible");
    expect(merged.roleFamily.value).toBe("general_swe");
  });

  it("cannot replace known employment, arrangement, or location metadata", () => {
    const deterministic = extractDeterministicFacts({
      title: "Software Engineer",
      description: "Full-time hybrid role in Miami.",
      employmentType: "Full-time",
      locations: ["Miami, FL"],
      workplaceType: "Hybrid",
    });
    const merged = mergeAiFacts(
      deterministic,
      analysis({
        employment: { value: "contract", confidence: "high", evidence: emptyEvidence },
        workArrangement: { value: "onsite", confidence: "high", evidence: emptyEvidence },
        locations: { value: ["Seattle, WA"], confidence: "high", evidence: emptyEvidence },
      }),
    );

    expect(merged.employment.value).toBe("full_time");
    expect(merged.workArrangement.value).toBe("hybrid");
    expect(merged.locations.value).toEqual(["Miami, FL"]);
  });

  it("retains only usable AI experience requirements and translates evidence", () => {
    const deterministic = extractDeterministicFacts({
      title: "Software Engineer",
      description: "Full-time role.",
      employmentType: "Full-time",
      locations: ["Miami, FL"],
      workplaceType: "Hybrid",
    });
    const evidence = { field: "experience", quote: "one year", start: 0, end: 8 };
    const merged = mergeAiFacts(
      deterministic,
      analysis({
        experienceRequirements: [
          {
            text: "one year",
            kind: "required",
            minimumYears: 1,
            maximumYears: 1,
            alternativePath: false,
            confidence: "high",
            evidence: [evidence],
          },
          {
            text: "unclear",
            kind: "preferred",
            minimumYears: null,
            maximumYears: null,
            alternativePath: false,
            confidence: "low",
            evidence: [],
          },
        ],
      }),
    );

    expect(merged.experienceRequirements).toEqual([
      expect.objectContaining({
        minimumYears: 1,
        preferred: false,
        evidence: expect.objectContaining({ source: "ai_extraction" }),
      }),
    ]);
  });
});
