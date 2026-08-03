import { pgEnum } from "drizzle-orm/pg-core";

export const companyOrigin = pgEnum("company_origin", ["manual", "referral", "discovered"]);
export const referralStatus = pgEnum("referral_status", [
  "available",
  "requested",
  "submitted",
  "declined",
  "unknown",
]);
export const connectorKind = pgEnum("connector_kind", [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workday",
  "icims",
  "jobvite",
  "custom_jsonld",
  "custom_html",
  "brave",
  "adzuna",
  "unsupported",
]);
export const policyStatus = pgEnum("policy_status", [
  "approved",
  "conditional",
  "blocked",
  "pending_review",
]);
export const scheduleKind = pgEnum("schedule_kind", [
  "watchlist",
  "broad_discovery",
  "closure",
  "cleanup",
]);
export const runStatus = pgEnum("run_status", [
  "queued",
  "running",
  "succeeded",
  "partially_failed",
  "failed",
  "cancelled",
]);
export const observationStatus = pgEnum("observation_status", [
  "discovered",
  "verified",
  "unchanged",
  "changed",
  "not_found",
  "invalid",
  "failed",
]);
export const jobLifecycleStatus = pgEnum("job_lifecycle_status", [
  "pending_verification",
  "open",
  "possibly_closed",
  "closed",
  "reopened",
]);
export const employmentType = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "contract",
  "internship",
  "temporary",
  "unknown",
]);
export const confidenceLevel = pgEnum("confidence_level", ["low", "medium", "high"]);
export const eligibilityOutcome = pgEnum("eligibility_outcome", [
  "eligible",
  "ineligible",
  "review",
]);
export const analysisStatus = pgEnum("analysis_status", [
  "pending",
  "succeeded",
  "refused",
  "invalid",
  "failed",
  "budget_blocked",
]);
export const rankingDimension = pgEnum("ranking_dimension", [
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
]);
export const recommendationBand = pgEnum("recommendation_band", [
  "hot",
  "strong",
  "possible",
  "review",
  "not_recommended",
]);
export const queueStatus = pgEnum("queue_status", ["active", "saved", "applied", "dismissed"]);
export const actionKind = pgEnum("action_kind", [
  "viewed",
  "saved",
  "applied",
  "dismissed",
  "restored",
  "opened_official_application",
]);
export const notificationKind = pgEnum("notification_kind", [
  "exceptional_match",
  "morning_digest",
  "operational_alert",
]);
export const deliveryStatus = pgEnum("delivery_status", [
  "pending",
  "deferred",
  "sending",
  "delivered",
  "failed",
  "suppressed",
]);
export const costProvider = pgEnum("cost_provider", [
  "openai",
  "brave",
  "adzuna",
  "inngest",
  "slack",
]);
export const outboxStatus = pgEnum("outbox_status", [
  "pending",
  "dispatching",
  "dispatched",
  "failed",
]);
