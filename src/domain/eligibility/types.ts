export type Evidence = {
  field: string;
  quote: string;
  start: number;
  end: number;
  source: "description" | "title" | "metadata" | "ai_extraction";
};

export type Confidence = "low" | "medium" | "high";
export type Fact<T> = {
  value: T;
  confidence: Confidence;
  evidence: Evidence[];
};

export type ExperienceRequirement = {
  minimumYears: number;
  maximumYears: number | null;
  preferred: boolean;
  alternativePath: boolean;
  evidence: Evidence;
};

export type Employment =
  "full_time" | "part_time" | "contract" | "internship" | "temporary" | "unknown";

export type Clearance = "required" | "not_required" | "not_mentioned" | "uncertain";
export type Sponsorship = "compatible" | "incompatible" | "not_mentioned" | "uncertain";
export type WorkArrangement = "onsite" | "hybrid" | "fully_remote" | "unknown";
export type LocationEligibility = "eligible" | "ineligible" | "review";
export type RoleFamily =
  | "general_swe"
  | "full_stack"
  | "backend"
  | "frontend"
  | "ai_engineering"
  | "embedded"
  | "internal_automation"
  | "customer_facing"
  | "other";

export type JobInput = {
  title: string;
  description: string;
  employmentType?: string | null;
  locations?: string[];
  workplaceType?: string | null;
};

export type ExtractedJobFacts = {
  employment: Fact<Employment>;
  experienceRequirements: ExperienceRequirement[];
  clearance: Fact<Clearance>;
  publicTrust: Fact<Clearance>;
  sponsorship: Fact<Sponsorship>;
  workArrangement: Fact<WorkArrangement>;
  locations: Fact<string[]>;
  locationEligibility: Fact<LocationEligibility>;
  roleFamily: Fact<RoleFamily>;
};

export type DecisionReason = {
  code: string;
  message: string;
  hard: boolean;
  evidence: Evidence[];
};

export type EligibilityDecision = {
  outcome: "eligible" | "ineligible" | "review";
  ruleVersion: string;
  reasons: DecisionReason[];
  uncertainFields: string[];
  facts: ExtractedJobFacts;
};
