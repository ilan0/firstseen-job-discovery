import { describe, expect, it } from "vitest";
import {
  evaluateNotificationPolicy,
  presetPolicy,
  priorityAlertRoleFamilies,
  type NotificationCandidate,
  type NotificationPolicy,
} from "./policy";

const policy: NotificationPolicy = {
  enabled: true,
  preset: "balanced",
  immediateHot: true,
  immediateStrong: true,
  immediatePossible: true,
  referralCompany: true,
  interestedCompany: true,
  hotStrongMaxAgeHours: 24,
  possibleMaxAgeHours: 6,
  roleFamilies: priorityAlertRoleFamilies,
  quietHoursEnabled: true,
  quietHoursStart: 23,
  quietHoursEnd: 7,
  timezone: "America/New_York",
};

const candidate: NotificationCandidate = {
  officiallyVerified: true,
  lifecycleStatus: "open",
  eligibilityOutcome: "eligible",
  uncertainFields: [],
  queueStatus: "active",
  band: "possible",
  roleFamily: "general_swe",
  freshnessAgeHours: 5.99,
  freshnessBasis: "posted_at",
  timestampReliable: true,
  hasActiveReferral: false,
  interestedCompany: false,
  companyOverrideMode: null,
  alreadyAlerted: false,
};

describe("push notification policy", () => {
  it("expands the balanced and all-viable presets", () => {
    expect(presetPolicy("balanced")).toMatchObject({
      immediatePossible: true,
      possibleMaxAgeHours: 6,
    });
    expect(presetPolicy("all_viable")).toMatchObject({ possibleMaxAgeHours: 24 });
    expect(presetPolicy("off")).toMatchObject({ enabled: false });
  });

  it("alerts a priority-role Possible match before the six-hour boundary", () => {
    expect(
      evaluateNotificationPolicy(candidate, policy, new Date("2026-08-05T16:00:00Z")),
    ).toMatchObject({
      eligible: true,
      reason: "possible",
    });
  });

  it("includes the exact six and 24 hour boundaries", () => {
    expect(
      evaluateNotificationPolicy({ ...candidate, freshnessAgeHours: 6 }, policy),
    ).toMatchObject({
      eligible: true,
      reason: "possible",
    });
    expect(
      evaluateNotificationPolicy({ ...candidate, band: "strong", freshnessAgeHours: 24 }, policy),
    ).toMatchObject({ eligible: true, reason: "strong" });
    expect(
      evaluateNotificationPolicy(
        { ...candidate, band: "strong", freshnessAgeHours: 24.001 },
        policy,
      ),
    ).toEqual({ eligible: false, reason: "stale" });
  });

  it("rejects a Possible match after six hours or outside selected roles", () => {
    expect(evaluateNotificationPolicy({ ...candidate, freshnessAgeHours: 6.01 }, policy)).toEqual({
      eligible: false,
      reason: "stale",
    });
    expect(evaluateNotificationPolicy({ ...candidate, roleFamily: "embedded" }, policy)).toEqual({
      eligible: false,
      reason: "role_disabled",
    });
  });

  it("promotes eligible referral and interested-company Possible matches to 24 hours", () => {
    expect(
      evaluateNotificationPolicy(
        { ...candidate, freshnessAgeHours: 23, hasActiveReferral: true },
        policy,
      ),
    ).toMatchObject({ eligible: true, reason: "referral", maxAgeHours: 24 });
    expect(
      evaluateNotificationPolicy(
        { ...candidate, freshnessAgeHours: 23, interestedCompany: true },
        policy,
      ),
    ).toMatchObject({ eligible: true, reason: "interested", maxAgeHours: 24 });
  });

  it("makes company mute win and never bypasses universal gates", () => {
    expect(
      evaluateNotificationPolicy({ ...candidate, companyOverrideMode: "mute" }, policy),
    ).toEqual({ eligible: false, reason: "company_muted" });
    expect(
      evaluateNotificationPolicy(
        { ...candidate, companyOverrideMode: "always", eligibilityOutcome: "ineligible" },
        policy,
      ),
    ).toEqual({ eligible: false, reason: "ineligible" });
  });

  it("makes Always alert independent of global band, role, and freshness selections", () => {
    expect(
      evaluateNotificationPolicy(
        {
          ...candidate,
          roleFamily: "embedded",
          freshnessAgeHours: 23.99,
          companyOverrideMode: "always",
        },
        { ...policy, immediatePossible: false, hotStrongMaxAgeHours: 6, roleFamilies: [] },
      ),
    ).toMatchObject({ eligible: true, reason: "company_always", maxAgeHours: 24 });
  });

  it("keeps relationship promotion at 24 hours even under a tighter custom band window", () => {
    expect(
      evaluateNotificationPolicy(
        { ...candidate, freshnessAgeHours: 23.99, hasActiveReferral: true },
        { ...policy, hotStrongMaxAgeHours: 6 },
      ),
    ).toMatchObject({ eligible: true, reason: "referral", maxAgeHours: 24 });
  });

  it("never alerts Review, acted, duplicate, or first-seen fallback jobs", () => {
    expect(
      evaluateNotificationPolicy({ ...candidate, eligibilityOutcome: "review" }, policy),
    ).toEqual({
      eligible: false,
      reason: "review",
    });
    expect(evaluateNotificationPolicy({ ...candidate, queueStatus: "saved" }, policy)).toEqual({
      eligible: false,
      reason: "acted",
    });
    expect(evaluateNotificationPolicy({ ...candidate, alreadyAlerted: true }, policy)).toEqual({
      eligible: false,
      reason: "already_alerted",
    });
    expect(
      evaluateNotificationPolicy(
        { ...candidate, freshnessBasis: "first_seen", timestampReliable: false },
        policy,
      ),
    ).toEqual({ eligible: false, reason: "timestamp_unreliable" });
  });

  it("does not treat material analysis changes as a new occurrence", () => {
    expect(
      evaluateNotificationPolicy(
        { ...candidate, alreadyAlerted: true, freshnessAgeHours: 1 },
        policy,
      ),
    ).toEqual({ eligible: false, reason: "already_alerted" });
  });

  it("allows a reliable reopening to alert as a distinct occurrence", () => {
    expect(
      evaluateNotificationPolicy(
        { ...candidate, lifecycleStatus: "reopened", freshnessBasis: "reopened_at" },
        policy,
      ),
    ).toMatchObject({ eligible: true, reason: "possible" });
  });

  it("turns every alert off without changing feed eligibility", () => {
    expect(evaluateNotificationPolicy(candidate, { ...policy, enabled: false })).toEqual({
      eligible: false,
      reason: "disabled",
    });
  });

  it("defers overnight to the quiet-hours end", () => {
    const decision = evaluateNotificationPolicy(
      candidate,
      policy,
      new Date("2026-08-06T03:00:00Z"),
    );
    expect(decision).toMatchObject({ eligible: true });
    if (decision.eligible)
      expect(decision.notBefore.toISOString()).toBe("2026-08-06T11:00:00.000Z");
  });
});
