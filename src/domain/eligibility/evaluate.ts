import type { DecisionReason, EligibilityDecision, ExtractedJobFacts } from "./types";

export const ELIGIBILITY_RULE_VERSION = "2026-08-04.2";
export const MAX_REQUIRED_YEARS = 2;

export type EligibilityPolicy = {
  fullTimeOnly?: boolean;
  eligibleRequiredYearsMax?: number;
  rejectClearance?: boolean;
  rejectPublicTrust?: boolean;
  needsUsSponsorship?: boolean;
};

export function evaluateEligibility(
  facts: ExtractedJobFacts,
  policy: EligibilityPolicy = {},
): EligibilityDecision {
  const reasons: DecisionReason[] = [];
  const uncertainFields = new Set<string>();
  const maximumRequiredYears = policy.eligibleRequiredYearsMax ?? MAX_REQUIRED_YEARS;
  const fullTimeOnly = policy.fullTimeOnly ?? true;

  if (fullTimeOnly && facts.employment.value === "unknown") {
    uncertainFields.add("employment_type");
    reasons.push({
      code: "EMPLOYMENT_UNKNOWN",
      message: "Full-time employment could not be confirmed.",
      hard: false,
      evidence: facts.employment.evidence,
    });
  } else if (fullTimeOnly && facts.employment.value !== "full_time") {
    reasons.push({
      code: "NOT_FULL_TIME",
      message: "The role is not full-time employment.",
      hard: true,
      evidence: facts.employment.evidence,
    });
  }

  const requiredExperience = facts.experienceRequirements.filter(
    (requirement) => !requirement.preferred,
  );
  const excessive = requiredExperience.filter(
    (requirement) =>
      requirement.minimumYears > maximumRequiredYears && !requirement.alternativePath,
  );
  if (excessive.length) {
    reasons.push({
      code: "REQUIRED_EXPERIENCE_EXCEEDS_MAXIMUM",
      message: `The role requires more than ${maximumRequiredYears} years of experience.`,
      hard: true,
      evidence: excessive.map((requirement) => requirement.evidence),
    });
  }
  const alternatives = requiredExperience.filter((requirement) => requirement.alternativePath);
  if (alternatives.length) {
    uncertainFields.add("required_experience_alternative");
    reasons.push({
      code: "EXPERIENCE_ALTERNATIVE_REQUIRES_REVIEW",
      message: "An experience requirement includes an alternative qualification path.",
      hard: false,
      evidence: alternatives.map((requirement) => requirement.evidence),
    });
  }

  if ((policy.rejectClearance ?? true) && facts.clearance.value === "required") {
    reasons.push({
      code: "SECURITY_CLEARANCE_REQUIRED",
      message: "The role requires a security clearance or the ability to obtain one.",
      hard: true,
      evidence: facts.clearance.evidence,
    });
  } else if ((policy.rejectClearance ?? true) && facts.clearance.value === "uncertain") {
    uncertainFields.add("security_clearance");
  }

  if ((policy.rejectPublicTrust ?? true) && facts.publicTrust.value === "required") {
    reasons.push({
      code: "PUBLIC_TRUST_REQUIRED",
      message: "The role requires a clearance or equivalent federal suitability determination.",
      hard: true,
      evidence: facts.publicTrust.evidence,
    });
  } else if ((policy.rejectPublicTrust ?? true) && facts.publicTrust.value === "uncertain") {
    uncertainFields.add("public_trust");
  }

  if (policy.needsUsSponsorship && facts.sponsorship.value === "incompatible") {
    reasons.push({
      code: "WORK_AUTHORIZATION_INCOMPATIBLE",
      message: "The employment authorization requirement is incompatible.",
      hard: true,
      evidence: facts.sponsorship.evidence,
    });
  } else if (policy.needsUsSponsorship && facts.sponsorship.value === "uncertain") {
    uncertainFields.add("work_authorization");
  }

  if (facts.locationEligibility.value === "ineligible") {
    reasons.push({
      code: "LOCATION_INELIGIBLE",
      message: "The role is outside the accepted onsite, hybrid, or fully remote locations.",
      hard: true,
      evidence: facts.locationEligibility.evidence,
    });
  } else if (facts.locationEligibility.value === "review") {
    uncertainFields.add("location_eligibility");
    reasons.push({
      code: "LOCATION_REQUIRES_REVIEW",
      message: "The role's location or remote employment eligibility is ambiguous.",
      hard: false,
      evidence: facts.locationEligibility.evidence,
    });
  }

  const hardExclusion = reasons.some((reason) => reason.hard);
  const outcome = hardExclusion ? "ineligible" : uncertainFields.size ? "review" : "eligible";

  return {
    outcome,
    ruleVersion: ELIGIBILITY_RULE_VERSION,
    reasons,
    uncertainFields: [...uncertainFields],
    facts,
  };
}
