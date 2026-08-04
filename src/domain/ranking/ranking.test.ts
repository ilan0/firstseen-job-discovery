import { describe, expect, it } from "vitest";
import { evaluateEligibility, extractDeterministicFacts } from "@/domain/eligibility";
import { rankJob } from "./rank";

const now = new Date("2026-08-03T14:00:00Z");

function input(description: string, title = "Software Engineer") {
  return {
    title,
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

  it.each(["Senior Software Engineer", "Engineering Manager", "Intermediate Backend Engineer"])(
    "does not recommend an obvious advanced title without contrary early-career prose: %s",
    (title) => {
      const value = input("Full-time software role based in Miami.", title);
      expect(rankJob(value)).toMatchObject({
        band: "not_recommended",
        headline: "The title signals a mid-level, senior, or leadership role",
      });
    },
  );

  it("lets an explicit early-career requirement outweigh an inflated seniority label", () => {
    const value = input(
      "Full-time software role requiring 0-2 years of experience in Miami.",
      "Senior Software Engineer",
    );
    expect(rankJob(value).band).not.toBe("not_recommended");
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

  it("uses persisted role priorities instead of a candidate-specific module constant", () => {
    const value = input("Full-time role requiring 0-2 years of experience in Miami.");
    const role = rankJob({
      ...value,
      rolePriorities: [{ family: "general_swe", priority: 8 }],
    }).dimensions.find((item) => item.dimension === "role_family_alignment");
    expect(role).toMatchObject({ value: 35 });
  });

  it("matches category-equivalent skills and excludes eligibility conditions from skills fit", () => {
    const value = input("Full-time role requiring 0-1 years of experience in Miami.");
    value.requiredSkills = [
      "Full stack web development fundamentals",
      "Frontend frameworks",
      "Backend APIs",
      "Databases",
      "Ability to work on-site in New York, NY",
      "Eligibility to work in the US",
    ];
    value.candidateSkills = ["TypeScript", "React", "Node.js", "REST APIs", "PostgreSQL"];
    const skills = rankJob(value).dimensions.find((item) => item.dimension === "skills_fit");
    expect(skills).toMatchObject({
      value: 80,
      explanation: "4 of 4 explicit required skills match the profile.",
    });
    expect(skills?.evidence).toEqual(expect.arrayContaining(["React", "Node.js", "PostgreSQL"]));
  });

  it("does not report zero skills when the extraction contains only non-skill conditions", () => {
    const value = input("Full-time role requiring 0-1 years of experience in Miami.");
    value.requiredSkills = ["US work authorization", "Ability to work on-site in Miami"];
    value.preferredSkills = [];
    const skills = rankJob(value).dimensions.find((item) => item.dimension === "skills_fit");
    expect(skills).toMatchObject({
      value: 62,
      explanation: "The description contains no reliable explicit required-skill list.",
    });
  });
});
