import { describe, expect, it } from "vitest";
import {
  evaluateEligibility,
  extractDeterministicFacts,
  isPotentialSoftwareRole,
  type JobInput,
} from ".";

const baseJob: JobInput = {
  title: "Software Engineer",
  description: "This is a full-time role. One year of professional experience required.",
  employmentType: "Full-time",
  locations: ["Fairfax, VA"],
  workplaceType: "On-site",
};

function decide(overrides: Partial<JobInput> = {}) {
  return evaluateEligibility(extractDeterministicFacts({ ...baseJob, ...overrides }));
}

describe("deterministic eligibility", () => {
  it("accepts a full-time zero-to-one-year local SWE role", () => {
    const decision = decide();

    expect(decision.outcome).toBe("eligible");
    expect(decision.facts.roleFamily.value).toBe("general_swe");
  });

  it("accepts two required years", () => {
    expect(
      decide({ description: "Full-time. 2 years of relevant experience required." }).outcome,
    ).toBe("eligible");
  });

  it("enforces the persisted per-user experience ceiling", () => {
    const facts = extractDeterministicFacts({
      ...baseJob,
      description: "Full-time. 3 years of relevant experience required.",
    });
    expect(evaluateEligibility(facts, { eligibleRequiredYearsMax: 4 }).outcome).toBe("eligible");
    expect(evaluateEligibility(facts, { eligibleRequiredYearsMax: 2 }).outcome).toBe("ineligible");
  });

  it("rejects more than two required years", () => {
    const decision = decide({
      description: "Full-time. 3+ years of professional experience required.",
    });

    expect(decision.outcome).toBe("ineligible");
    expect(decision.reasons.map((reason) => reason.code)).toContain(
      "REQUIRED_EXPERIENCE_EXCEEDS_MAXIMUM",
    );
  });

  it.each([
    "5+ years of engineering experience working on production systems.",
    "3+ years in engineering management.",
    "Seven years building scalable software platforms.",
    "4 years of hands-on backend development experience.",
  ])("rejects common excessive-experience wording: %s", (requirement) => {
    expect(decide({ description: `Full-time. ${requirement}` }).outcome).toBe("ineligible");
  });

  it.each([
    "Five or more years of software engineering experience is required.",
    "Minimum of 3+ plus years of audit experience is required.",
    "More than 2 years of engineering experience is required.",
    "Over two years’ professional development experience is required.",
  ])("understands additional strict experience wording: %s", (requirement) => {
    expect(decide({ description: `Full-time. ${requirement}` }).outcome).toBe("ineligible");
  });

  it.each([
    "We have 10 years of engineering experience serving our customers.",
    "Our founding team has over 12 years of software engineering experience.",
    "With over 15 years of industry experience, we build durable products.",
  ])("does not confuse employer history with a candidate requirement: %s", (description) => {
    const decision = decide({ description: `Full-time. ${description}` });
    expect(decision.facts.experienceRequirements).toEqual([]);
    expect(decision.outcome).toBe("eligible");
  });

  it("does not treat 'or equivalent' as waiving a required number of years", () => {
    expect(
      decide({ description: "Full-time. 5+ years of engineering experience or equivalent." })
        .outcome,
    ).toBe("ineligible");
  });

  it("uses the minimum of a required range", () => {
    expect(decide({ description: "Full-time. 2-4 years of software experience." }).outcome).toBe(
      "eligible",
    );
    expect(decide({ description: "Full-time. 3-5 years of software experience." }).outcome).toBe(
      "ineligible",
    );
  });

  it("does not reject excessive preferred experience", () => {
    const decision = decide({
      description: "Full-time role.\nPreferred qualifications:\n5+ years of relevant experience.",
    });

    expect(decision.outcome).toBe("eligible");
    expect(decision.facts.experienceRequirements[0]?.preferred).toBe(true);
  });

  it("does not let a later preferred section soften a required experience line", () => {
    const decision = decide({
      description:
        "Required qualifications:\n5+ years of professional experience.\nPreferred qualifications:\nReact experience.",
    });
    expect(decision.outcome).toBe("ineligible");
  });

  it("reviews alternative experience paths instead of rejecting", () => {
    const decision = decide({
      description: "Full-time. 4 years of relevant experience or a bachelor's degree.",
    });

    expect(decision.outcome).toBe("review");
    expect(decision.uncertainFields).toContain("required_experience_alternative");
  });

  it.each([
    "active Secret clearance",
    "ability to obtain a security clearance",
    "TS/SCI clearance",
  ])("rejects clearance language: %s", (language) => {
    const decision = decide({ description: `Full-time role requiring ${language}.` });

    expect(decision.outcome).toBe("ineligible");
    expect(decision.reasons.map((reason) => reason.code)).toContain("SECURITY_CLEARANCE_REQUIRED");
  });

  it("accepts an explicit statement that no clearance is required", () => {
    expect(decide({ description: "Full-time. No security clearance is required." }).outcome).toBe(
      "eligible",
    );
  });

  it.each([
    "No security clearance or Public Trust is required.",
    "Security clearance and Public Trust are not required.",
  ])("accepts compound explicit negation: %s", (description) => {
    const decision = decide({ description: `Full-time. ${description}` });
    expect(decision.outcome).toBe("eligible");
    expect(decision.facts.clearance.value).toBe("not_required");
    expect(decision.facts.publicTrust.value).toBe("not_required");
  });

  it("does not mistake a background check for clearance", () => {
    expect(
      decide({ description: "Full-time. Must pass a standard background check." }).outcome,
    ).toBe("eligible");
  });

  it.each(["Public Trust", "high risk suitability determination"])(
    "rejects Public Trust or suitability language: %s",
    (language) => {
      const decision = decide({ description: `Full-time. Must obtain ${language}.` });

      expect(decision.outcome).toBe("ineligible");
      expect(decision.reasons.map((reason) => reason.code)).toContain("PUBLIC_TRUST_REQUIRED");
    },
  );

  it.each(["Part-time", "Contract", "Internship", "Temporary"])(
    "rejects non-full-time metadata: %s",
    (employmentType) => {
      expect(decide({ employmentType }).outcome).toBe("ineligible");
    },
  );

  it("reviews an unknown employment type", () => {
    const decision = decide({ employmentType: null, description: "Build reliable software." });

    expect(decision.outcome).toBe("review");
    expect(decision.uncertainFields).toContain("employment_type");
  });

  it.each([
    "Miami, FL",
    "Fort Lauderdale, FL",
    "Washington, DC",
    "Tysons, VA",
    "New York, NY",
    "Brooklyn, NY",
  ])("accepts an eligible location: %s", (location) => {
    expect(decide({ locations: [location] }).outcome).toBe("eligible");
  });

  it.each(["Jersey City, NJ", "Hoboken, New Jersey", "Seattle, WA"])(
    "rejects an ineligible onsite location: %s",
    (location) => {
      expect(decide({ locations: [location] }).outcome).toBe("ineligible");
    },
  );

  it("uses persisted accepted-area selections instead of admitting every built-in region", () => {
    const facts = extractDeterministicFacts(
      { ...baseJob, locations: ["Miami, FL"] },
      {
        acceptedAreas: [{ id: "dmv", anchor: "Fairfax, VA" }],
        allowFullyRemote: true,
      },
    );
    expect(evaluateEligibility(facts).outcome).toBe("ineligible");
  });

  it("reviews a New York metro location that might be in New Jersey", () => {
    expect(decide({ locations: ["New York Metropolitan Area"] }).outcome).toBe("review");
  });

  it.each(["Florida", "Virginia", "New York", "United States"])(
    "reviews an ambiguous onsite region instead of excluding it: %s",
    (location) => {
      expect(decide({ locations: [location] }).outcome).toBe("review");
    },
  );

  it("accepts fully remote US work", () => {
    expect(
      decide({
        locations: ["Remote - United States"],
        workplaceType: "Remote",
        description: "Full-time remote software role.",
      }).outcome,
    ).toBe("eligible");
  });

  it("rejects fully remote work when the persisted preference disables it", () => {
    const facts = extractDeterministicFacts(
      {
        ...baseJob,
        locations: ["Remote - United States"],
        workplaceType: "Remote",
        description: "Full-time remote software role.",
      },
      { acceptedAreas: [{ id: "dmv" }], allowFullyRemote: false },
    );
    expect(evaluateEligibility(facts).outcome).toBe("ineligible");
  });

  it("rejects remote work restricted to New Jersey", () => {
    expect(
      decide({
        locations: ["Remote in New Jersey"],
        workplaceType: "Remote",
        description: "Full-time remote role only in New Jersey.",
      }).outcome,
    ).toBe("ineligible");
  });

  it.each([
    "Remote - Canada",
    "United Kingdom (Remote)",
    "EMEA - Remote",
    "Sweden (Remote)",
    "Remote - France",
    "UK remote",
    "Remote — Brazil",
    "Tokyo, Japan (Remote)",
  ])("rejects a remote job explicitly restricted to an unsupported region: %s", (location) => {
    expect(
      decide({
        locations: [location],
        workplaceType: "Remote",
        description: "Full-time remote software role.",
      }).outcome,
    ).toBe("ineligible");
  });

  it("accepts no-sponsorship language for the candidate", () => {
    const decision = decide({
      description: "Full-time. We are unable to provide employment sponsorship.",
    });

    expect(decision.outcome).toBe("eligible");
    expect(decision.facts.sponsorship.value).toBe("compatible");
  });

  it("applies sponsorship availability only when the persisted profile needs sponsorship", () => {
    const facts = extractDeterministicFacts(baseJob);
    facts.sponsorship = {
      value: "incompatible",
      confidence: "high",
      evidence: [],
    };
    expect(evaluateEligibility(facts, { needsUsSponsorship: false }).outcome).toBe("eligible");
    expect(evaluateEligibility(facts, { needsUsSponsorship: true }).outcome).toBe("ineligible");
  });

  it("classifies role families without making them hard filters", () => {
    expect(decide({ title: "Full-Stack Engineer" }).facts.roleFamily.value).toBe("full_stack");
    expect(decide({ title: "Backend Engineer" }).facts.roleFamily.value).toBe("backend");
    expect(decide({ title: "Frontend Engineer" }).facts.roleFamily.value).toBe("frontend");
    expect(decide({ title: "AI Engineer" }).facts.roleFamily.value).toBe("ai_engineering");
    expect(decide({ title: "Embedded Software Engineer" }).facts.roleFamily.value).toBe("embedded");
    expect(decide({ title: "Solutions Engineer" }).facts.roleFamily.value).toBe("customer_facing");
    expect(decide({ title: "Member of Technical Staff" }).facts.roleFamily.value).toBe(
      "general_swe",
    );
  });

  it("allows ambiguous technical titles through to AI without admitting unrelated engineering", () => {
    expect(isPotentialSoftwareRole("Junior Developer")).toBe(true);
    expect(isPotentialSoftwareRole("Technology Analyst")).toBe(true);
    expect(isPotentialSoftwareRole("Applied AI Engineer")).toBe(true);
    expect(isPotentialSoftwareRole("AI / ML Engineer")).toBe(true);
    expect(isPotentialSoftwareRole("Mechanical Engineer")).toBe(false);
    expect(isPotentialSoftwareRole("Product Manager")).toBe(false);
    expect(isPotentialSoftwareRole("AI Product Manager")).toBe(false);
    expect(isPotentialSoftwareRole("Sales Development Representative (US AI startup)")).toBe(false);
  });

  it("preserves evidence for hard exclusions", () => {
    const decision = decide({ description: "Full-time. Requires 5 years of relevant experience." });
    const evidence = decision.reasons.find(
      (reason) => reason.code === "REQUIRED_EXPERIENCE_EXCEEDS_MAXIMUM",
    )?.evidence[0];

    expect(evidence?.quote).toMatch(/5 years/i);
    expect(evidence?.start).toBeGreaterThanOrEqual(0);
  });
});
