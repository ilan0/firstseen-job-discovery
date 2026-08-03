import { describe, expect, it } from "vitest";
import { evaluateEligibility, extractDeterministicFacts } from "@/domain/eligibility";
import { rankJob } from "./rank";

const now = new Date("2026-08-03T14:00:00Z");

function input(description: string, title = "Software Engineer") {
  return {
    eligibility: evaluateEligibility(
      extractDeterministicFacts({
        title,
        description,
        employmentType: "Full-time",
        locations: ["Miami, FL"],
      }),
    ),
    roleFamily: "general_swe" as const,
    requiredSkills: ["TypeScript", "React"],
    preferredSkills: ["Python"],
    candidateSkills: ["TypeScript", "React", "Python"],
    postedAt: new Date("2026-08-03T10:00:00Z"),
    firstSeenAt: new Date("2026-08-03T11:00:00Z"),
    now,
    reliablePostedAt: true,
    hasReferral: false,
    sourceConfidence: 95,
    extractionConfidence: 90,
  };
}

describe("explainable deterministic ranking", () => {
  it("routes an excellent fresh role to hot without an opaque aggregate score", () => {
    const result = rankJob(input("Full-time role requiring 0-1 years of experience in Miami."));
    expect(result.band).toBe("hot");
    expect(result.dimensions).toHaveLength(10);
    expect(result.dimensions.map((item) => item.dimension)).toContain("competition_proxy");
    expect(result).not.toHaveProperty("score");
  });

  it("never ranks a hard exclusion", () => {
    const result = rankJob(
      input("Full-time role requiring an active Secret clearance and 0-1 years."),
    );
    expect(result.band).toBe("not_recommended");
    expect(result.dimensions).toEqual([]);
  });

  it("routes uncertain eligibility to review", () => {
    const value = input("Software role with 0-1 years of experience.");
    value.eligibility = evaluateEligibility(
      extractDeterministicFacts({
        title: "Software Engineer",
        description: "Software role with 0-1 years of experience.",
        employmentType: "Full-time",
        locations: ["New York metropolitan area"],
      }),
    );
    expect(rankJob(value).band).toBe("review");
  });

  it("exposes a referral advantage but does not disguise it as skills fit", () => {
    const value = input("Full-time role requiring 0-2 years of experience in Miami.");
    value.hasReferral = true;
    const result = rankJob(value);
    expect(result.dimensions.find((item) => item.dimension === "referral_advantage")?.value).toBe(
      100,
    );
    expect(result.dimensions.find((item) => item.dimension === "skills_fit")?.value).toBe(100);
  });
});
