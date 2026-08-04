import type { EligibilityDecision, RoleFamily } from "@/domain/eligibility";

export const RANKING_DIMENSIONS = [
  "skills_fit",
  "required_experience_alignment",
  "role_family_alignment",
  "freshness",
  "referral_advantage",
  "location_eligibility",
  "competition_proxy",
  "extraction_confidence",
  "source_confidence",
  "urgency",
] as const;

export type RankingDimensionName = (typeof RANKING_DIMENSIONS)[number];
export type RankingDimensionResult = {
  dimension: RankingDimensionName;
  value: number;
  confidence: number;
  explanation: string;
  evidence: string[];
};

export type RankingInput = {
  title: string;
  eligibility: EligibilityDecision;
  roleFamily: RoleFamily;
  requiredSkills: string[];
  preferredSkills: string[];
  candidateSkills: string[];
  rolePriorities?: Array<{ family: RoleFamily; priority: number }>;
  postedAt: Date | null;
  firstSeenAt: Date;
  reopenedAt?: Date | null;
  now: Date;
  reliablePostedAt: boolean;
  hasReferral: boolean;
  sourceConfidence: number;
  extractionConfidence: number;
  broadSensorFoundAt?: Date | null;
};

export type Recommendation = {
  version: string;
  band: "hot" | "strong" | "possible" | "review" | "not_recommended";
  urgency: number;
  headline: string;
  dimensions: RankingDimensionResult[];
  routingReasons: string[];
};
