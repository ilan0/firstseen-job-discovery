import { freshness as jobFreshness } from "@/domain/jobs";
import type {
  RankingDimensionName,
  RankingDimensionResult,
  RankingInput,
  Recommendation,
} from "./types";

export const RANKING_VERSION = "2026-08-04.3";

const advancedTitlePattern =
  /\b(?:senior|sr\.?|staff|principal|lead|manager|director|head|architect|intermediate)\b/i;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function dimension(
  name: RankingDimensionName,
  value: number,
  confidence: number,
  explanation: string,
  evidence: string[] = [],
): RankingDimensionResult {
  return {
    dimension: name,
    value: clamp(value),
    confidence: clamp(confidence),
    explanation,
    evidence,
  };
}

function normalizeSkill(skill: string): string {
  return skill.toLowerCase().replace(/[^a-z0-9+#.]/g, "");
}

const nonSkillRequirementPattern =
  /\b(?:authorization|authori[sz]ed|citizenship|clearance|degree|eligibility|hybrid|location|office|on[ -]?site|public trust|remote|sponsor(?:ship)?|visa|work in the (?:u\.?s\.?|united states))\b/i;

const skillCategories = [
  {
    requirement: /\b(?:front[ -]?end(?: frameworks?)?|client[ -]?side|web ui)\b/i,
    candidate: /\b(?:css|html|javascript|next(?:\.js|js)?|react|tailwind|typescript)\b/i,
  },
  {
    requirement: /\b(?:back[ -]?end(?: apis?)?|rest(?:ful)? apis?|server[ -]?side)\b/i,
    candidate: /\b(?:c#|java|node(?:\.js|js)?|python|rest apis?)\b/i,
  },
  {
    requirement: /\b(?:data stores?|databases?|persistence|relational data|sql)\b/i,
    candidate: /\b(?:postgres(?:ql)?|sqlite|sql|supabase)\b/i,
  },
  {
    requirement:
      /\b(?:ai\/ml|artificial intelligence|large language models?|llms?|machine learning)\b/i,
    candidate: /\b(?:ai vision|function calling|gemini|openai|structured outputs?)\b/i,
  },
  {
    requirement: /\b(?:automated testing|test driven development|testing|unit tests?)\b/i,
    candidate: /\b(?:tdd|testing|xunit)\b/i,
  },
  {
    requirement: /\b(?:full[ -]?stack|web development fundamentals?)\b/i,
    candidate: /\b(?:next(?:\.js|js)?|node(?:\.js|js)?|react|rest apis?|supabase)\b/i,
  },
] as const;

function matchingCandidateSkills(requirement: string, candidateSkills: string[]): string[] {
  const normalizedRequirement = normalizeSkill(requirement);
  const direct = candidateSkills.filter((candidateSkill) => {
    const normalizedCandidate = normalizeSkill(candidateSkill);
    return (
      normalizedCandidate === normalizedRequirement ||
      (normalizedCandidate.length >= 2 && normalizedRequirement.includes(normalizedCandidate)) ||
      (normalizedRequirement.length >= 3 && normalizedCandidate.includes(normalizedRequirement))
    );
  });
  if (direct.length) return direct;
  const category = skillCategories.find((item) => item.requirement.test(requirement));
  return category
    ? candidateSkills.filter((skill) => category.candidate.test(skill)).slice(0, 3)
    : [];
}

function skillsDimension(input: RankingInput): RankingDimensionResult {
  const required = input.requiredSkills.filter(
    (skill) => normalizeSkill(skill) && !nonSkillRequirementPattern.test(skill),
  );
  const preferred = input.preferredSkills.filter(
    (skill) => normalizeSkill(skill) && !nonSkillRequirementPattern.test(skill),
  );
  const requiredMatches = required.filter(
    (skill) => matchingCandidateSkills(skill, input.candidateSkills).length > 0,
  );
  const preferredMatches = preferred.filter(
    (skill) => matchingCandidateSkills(skill, input.candidateSkills).length > 0,
  );
  const requiredRatio = required.length ? requiredMatches.length / required.length : 0.65;
  const preferredRatio = preferred.length ? preferredMatches.length / preferred.length : 0.5;
  const value = requiredRatio * 80 + preferredRatio * 20;
  const evidence = [...requiredMatches, ...preferredMatches]
    .flatMap((skill) => matchingCandidateSkills(skill, input.candidateSkills))
    .filter((skill, index, all) => all.indexOf(skill) === index)
    .slice(0, 8);
  return dimension(
    "skills_fit",
    value,
    required.length ? 85 : 55,
    required.length
      ? `${requiredMatches.length} of ${required.length} explicit required skills match the profile.`
      : "The description contains no reliable explicit required-skill list.",
    evidence,
  );
}

function experienceDimension(input: RankingInput): RankingDimensionResult {
  const required = input.eligibility.facts.experienceRequirements.filter((item) => !item.preferred);
  if (!required.length) {
    return dimension(
      "required_experience_alignment",
      70,
      60,
      "No explicit minimum-years requirement was found; experience fit is treated as neutral.",
    );
  }
  const minimum = Math.max(...required.map((item) => item.minimumYears));
  const idealMaximum = input.idealRequiredYearsMax ?? 1;
  const eligibleMaximum = input.eligibleRequiredYearsMax ?? 2;
  const experienceYears = Math.max(0, input.monthsFullTimeExperience ?? 0) / 12;
  if (minimum <= idealMaximum) {
    return dimension(
      "required_experience_alignment",
      100,
      95,
      `The highest explicit minimum is ${minimum} year${minimum === 1 ? "" : "s"}, within the configured ideal maximum of ${idealMaximum}.`,
    );
  }
  return dimension(
    "required_experience_alignment",
    minimum <= eligibleMaximum ? 65 : 0,
    95,
    minimum <= eligibleMaximum
      ? `The ${minimum}-year minimum is above the configured ideal but within the eligible maximum of ${eligibleMaximum}; the profile records ${experienceYears.toFixed(1)} years of full-time experience.`
      : `The ${minimum}-year minimum exceeds the configured eligible maximum of ${eligibleMaximum}.`,
  );
}

function roleDimension(input: RankingInput): RankingDimensionResult {
  const priority =
    input.rolePriorities?.find((item) => item.family === input.roleFamily)?.priority ??
    {
      general_swe: 1,
      full_stack: 2,
      backend: 3,
      frontend: 4,
      ai_engineering: 5,
      embedded: 6,
      internal_automation: 7,
      customer_facing: 8,
      other: 9,
    }[input.roleFamily];
  const values: Record<number, number> = {
    1: 100,
    2: 93,
    3: 88,
    4: 80,
    5: 86,
    6: 55,
    7: 45,
    8: 35,
  };
  return dimension(
    "role_family_alignment",
    values[priority] ?? 25,
    input.eligibility.facts.roleFamily.confidence === "high" ? 95 : 70,
    `${input.roleFamily.replaceAll("_", " ")} is candidate role priority ${priority}.`,
  );
}

function freshnessDimension(input: RankingInput): RankingDimensionResult {
  const current = jobFreshness(
    input.now,
    input.postedAt,
    input.reliablePostedAt ? "high" : "low",
    input.firstSeenAt,
    input.reopenedAt,
  );
  return dimension(
    "freshness",
    current.value,
    current.basis === "posted_at" ? 95 : current.basis === "reopened_at" ? 100 : 70,
    `${current.basis === "posted_at" ? "Official posting time" : current.basis === "reopened_at" ? "Official reopening" : "First verified sighting"} is ${Math.round(current.ageHours)} hours old.`,
  );
}

export function rankJob(input: RankingInput): Recommendation {
  if (input.eligibility.outcome === "ineligible") {
    return {
      version: RANKING_VERSION,
      band: "not_recommended",
      urgency: 0,
      headline: "Excluded by a deterministic eligibility rule",
      dimensions: [],
      routingReasons: input.eligibility.reasons
        .filter((reason) => reason.hard)
        .map((reason) => reason.message),
    };
  }
  if (input.roleFamily === "other") {
    return {
      version: RANKING_VERSION,
      band: "not_recommended",
      urgency: 0,
      headline: "The title is not a supported software-engineering role family",
      dimensions: [],
      routingReasons: ["Role-family relevance filter"],
    };
  }
  const explicitRequiredExperience = input.eligibility.facts.experienceRequirements.filter(
    (item) => !item.preferred,
  );
  if (advancedTitlePattern.test(input.title) && !explicitRequiredExperience.length) {
    return {
      version: RANKING_VERSION,
      band: "not_recommended",
      urgency: 0,
      headline: "The title signals a mid-level, senior, or leadership role",
      dimensions: [],
      routingReasons: [
        "No explicit early-career experience requirement was found to outweigh the title-level mismatch",
      ],
    };
  }

  const skills = skillsDimension(input);
  const experience = experienceDimension(input);
  const role = roleDimension(input);
  const freshness = freshnessDimension(input);
  const referral = dimension(
    "referral_advantage",
    input.hasReferral ? 100 : 0,
    100,
    input.hasReferral
      ? "A referral contact is recorded for this company."
      : "No referral contact is recorded.",
  );
  const location = dimension(
    "location_eligibility",
    input.eligibility.facts.locationEligibility.value === "eligible" ? 100 : 45,
    input.eligibility.facts.locationEligibility.confidence === "high" ? 95 : 60,
    input.eligibility.facts.locationEligibility.value === "eligible"
      ? "The location passed deterministic eligibility."
      : "Location eligibility needs review.",
  );
  const competition = dimension(
    "competition_proxy",
    freshness.value >= 92 ? 90 : freshness.value >= 78 ? 70 : 45,
    35,
    "Freshness is used as a limited competition proxy; applicant counts are not available from the official source.",
  );
  const extraction = dimension(
    "extraction_confidence",
    input.extractionConfidence,
    100,
    `Requirement extraction confidence is ${clamp(input.extractionConfidence)}%.`,
  );
  const source = dimension(
    "source_confidence",
    input.sourceConfidence,
    100,
    `Official-source confidence is ${clamp(input.sourceConfidence)}%.`,
  );
  const urgencyValue = clamp(
    freshness.value * 0.55 +
      experience.value * 0.2 +
      (input.hasReferral ? 15 : 0) +
      source.value * 0.1,
  );
  const urgency = dimension(
    "urgency",
    urgencyValue,
    Math.min(freshness.confidence, source.confidence),
    urgencyValue >= 85
      ? "Apply as soon as practical while the listing is fresh."
      : "Apply after higher-urgency matches.",
  );
  const dimensions = [
    skills,
    experience,
    role,
    freshness,
    referral,
    location,
    competition,
    extraction,
    source,
    urgency,
  ];

  if (input.eligibility.outcome === "review" || extraction.value < 55 || source.value < 55) {
    return {
      version: RANKING_VERSION,
      band: "review",
      urgency: urgency.value,
      headline: "Promising details, but eligibility or extraction needs review",
      dimensions,
      routingReasons: [...input.eligibility.uncertainFields, "Confidence gate requires review"],
    };
  }

  const isHot =
    freshness.value >= 92 &&
    experience.value >= 90 &&
    role.value >= 80 &&
    skills.value >= 72 &&
    source.value >= 80;
  const isStrong =
    experience.value >= 65 && role.value >= 75 && skills.value >= 58 && source.value >= 70;
  const band = isHot ? "hot" : isStrong ? "strong" : "possible";
  return {
    version: RANKING_VERSION,
    band,
    urgency: urgency.value,
    headline:
      band === "hot"
        ? "Fresh early-career match—apply now"
        : band === "strong"
          ? "Strong fit across the most important dimensions"
          : "Viable role worth considering",
    dimensions,
    routingReasons: [
      `Experience ${experience.value}`,
      `Role family ${role.value}`,
      `Skills ${skills.value}`,
      `Freshness ${freshness.value}`,
    ],
  };
}
