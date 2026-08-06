import type { RoleFamily } from "@/domain/eligibility/types";
import { hoursUntilQuietEnd, inQuietHours, zonedParts } from "@/lib/notifications/time";

export const PUSH_POLICY_VERSION = "2026-08-05.1";

export const priorityAlertRoleFamilies: RoleFamily[] = [
  "general_swe",
  "full_stack",
  "backend",
  "frontend",
  "ai_engineering",
];

export type AlertPreset = "off" | "selective" | "balanced" | "all_viable" | "custom";
export type CompanyAlertMode = "always" | "mute" | null;

export type NotificationPolicy = {
  enabled: boolean;
  preset: AlertPreset;
  immediateHot: boolean;
  immediateStrong: boolean;
  immediatePossible: boolean;
  referralCompany: boolean;
  interestedCompany: boolean;
  hotStrongMaxAgeHours: number;
  possibleMaxAgeHours: number;
  roleFamilies: RoleFamily[];
  quietHoursEnabled: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  timezone: string;
};

export type NotificationCandidate = {
  officiallyVerified: boolean;
  lifecycleStatus: "open" | "reopened" | "closed" | "possibly_closed" | string;
  eligibilityOutcome: "eligible" | "ineligible" | "review";
  uncertainFields: string[];
  queueStatus: "active" | "saved" | "applied" | "dismissed";
  band: "hot" | "strong" | "possible" | "review" | "not_recommended";
  roleFamily: RoleFamily;
  freshnessAgeHours: number;
  freshnessBasis: "posted_at" | "reopened_at" | "first_seen";
  timestampReliable: boolean;
  hasActiveReferral: boolean;
  interestedCompany: boolean;
  companyOverrideMode: CompanyAlertMode;
  alreadyAlerted: boolean;
};

export type NotificationPolicyDecision =
  | {
      eligible: true;
      reason: "hot" | "strong" | "possible" | "referral" | "interested" | "company_always";
      notBefore: Date;
      maxAgeHours: number;
    }
  | {
      eligible: false;
      reason:
        | "disabled"
        | "company_muted"
        | "unverified"
        | "closed"
        | "ineligible"
        | "review"
        | "acted"
        | "timestamp_unreliable"
        | "already_alerted"
        | "band_disabled"
        | "role_disabled"
        | "stale";
    };

export function presetPolicy(preset: Exclude<AlertPreset, "custom">): Partial<NotificationPolicy> {
  if (preset === "off")
    return {
      enabled: false,
      immediateHot: false,
      immediateStrong: false,
      immediatePossible: false,
    };
  if (preset === "selective")
    return {
      enabled: true,
      immediateHot: true,
      immediateStrong: true,
      immediatePossible: false,
      hotStrongMaxAgeHours: 24,
      possibleMaxAgeHours: 6,
      roleFamilies: priorityAlertRoleFamilies,
    };
  if (preset === "all_viable")
    return {
      enabled: true,
      immediateHot: true,
      immediateStrong: true,
      immediatePossible: true,
      hotStrongMaxAgeHours: 24,
      possibleMaxAgeHours: 24,
      roleFamilies: priorityAlertRoleFamilies,
    };
  return {
    enabled: true,
    immediateHot: true,
    immediateStrong: true,
    immediatePossible: true,
    hotStrongMaxAgeHours: 24,
    possibleMaxAgeHours: 6,
    roleFamilies: priorityAlertRoleFamilies,
  };
}

export function evaluateNotificationPolicy(
  candidate: NotificationCandidate,
  policy: NotificationPolicy,
  now = new Date(),
): NotificationPolicyDecision {
  if (!candidate.officiallyVerified) return { eligible: false, reason: "unverified" };
  if (candidate.lifecycleStatus !== "open" && candidate.lifecycleStatus !== "reopened")
    return { eligible: false, reason: "closed" };
  if (candidate.eligibilityOutcome === "ineligible")
    return { eligible: false, reason: "ineligible" };
  if (candidate.eligibilityOutcome === "review" || candidate.uncertainFields.length)
    return { eligible: false, reason: "review" };
  if (candidate.queueStatus !== "active") return { eligible: false, reason: "acted" };
  if (
    !candidate.timestampReliable ||
    (candidate.freshnessBasis !== "posted_at" && candidate.freshnessBasis !== "reopened_at")
  )
    return { eligible: false, reason: "timestamp_unreliable" };
  if (candidate.alreadyAlerted) return { eligible: false, reason: "already_alerted" };
  if (candidate.companyOverrideMode === "mute") return { eligible: false, reason: "company_muted" };
  if (!policy.enabled || policy.preset === "off") return { eligible: false, reason: "disabled" };
  if (candidate.band === "review" || candidate.band === "not_recommended")
    return { eligible: false, reason: "review" };

  const referral = policy.referralCompany && candidate.hasActiveReferral;
  const interested = policy.interestedCompany && candidate.interestedCompany;
  const always = candidate.companyOverrideMode === "always";
  let reason: Extract<NotificationPolicyDecision, { eligible: true }>["reason"];
  let maxAgeHours: number;
  if (always) {
    reason = "company_always";
    maxAgeHours = 24;
  } else if (referral) {
    reason = "referral";
    maxAgeHours = 24;
  } else if (interested) {
    reason = "interested";
    maxAgeHours = 24;
  } else if (candidate.band === "hot" && policy.immediateHot) {
    reason = "hot";
    maxAgeHours = policy.hotStrongMaxAgeHours;
  } else if (candidate.band === "strong" && policy.immediateStrong) {
    reason = "strong";
    maxAgeHours = policy.hotStrongMaxAgeHours;
  } else if (candidate.band === "possible" && policy.immediatePossible) {
    if (!policy.roleFamilies.includes(candidate.roleFamily))
      return { eligible: false, reason: "role_disabled" };
    reason = "possible";
    maxAgeHours = policy.possibleMaxAgeHours;
  } else {
    return { eligible: false, reason: "band_disabled" };
  }
  if (candidate.freshnessAgeHours > maxAgeHours) return { eligible: false, reason: "stale" };

  const localHour = zonedParts(now, policy.timezone).hour;
  const deferHours =
    policy.quietHoursEnabled &&
    inQuietHours(localHour, policy.quietHoursStart, policy.quietHoursEnd)
      ? hoursUntilQuietEnd(localHour, policy.quietHoursStart, policy.quietHoursEnd)
      : 0;
  return {
    eligible: true,
    reason,
    maxAgeHours,
    notBefore: new Date(now.getTime() + deferHours * 3_600_000),
  };
}
