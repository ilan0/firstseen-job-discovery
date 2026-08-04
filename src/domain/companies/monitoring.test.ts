// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  adaptiveColdCadenceMinutes,
  deriveMonitoringPolicy,
  isActiveReferralStatus,
  isRecentViableRecommendation,
} from "./monitoring";

describe("company monitoring policy", () => {
  it.each([
    [{ scope: "personal" as const, interested: true, hasActiveReferral: false }, "priority", 15],
    [{ scope: "personal" as const, interested: false, hasActiveReferral: true }, "priority", 15],
    [{ scope: "personal" as const, interested: false, hasActiveReferral: false }, "standard", 60],
    [
      {
        scope: "discovered" as const,
        interested: false,
        hasActiveReferral: false,
        hasRecentViableMatch: true,
      },
      "warm",
      60,
    ],
    [{ scope: "discovered" as const, interested: false, hasActiveReferral: false }, "cold", 240],
  ])("derives tier and cadence independently", (input, tier, cadenceMinutes) => {
    expect(deriveMonitoringPolicy(input)).toMatchObject({ tier, cadenceMinutes, active: true });
  });

  it("quarantines without inheriting another tier", () => {
    expect(
      deriveMonitoringPolicy({
        scope: "personal",
        interested: true,
        hasActiveReferral: true,
        quarantined: true,
      }),
    ).toEqual({ tier: "quarantined", cadenceMinutes: 240, active: false });
  });

  it("uses only actionable referral statuses", () => {
    expect(["available", "requested", "submitted"].every(isActiveReferralStatus)).toBe(true);
    expect(["declined", "unknown"].some(isActiveReferralStatus)).toBe(false);
  });

  it("warms only eligible recent Hot, Strong, or Possible roles", () => {
    expect(
      isRecentViableRecommendation({
        band: "possible",
        eligibilityOutcome: "eligible",
        ageHours: 168,
      }),
    ).toBe(true);
    expect(
      isRecentViableRecommendation({ band: "review", eligibilityOutcome: "review", ageHours: 2 }),
    ).toBe(false);
    expect(
      isRecentViableRecommendation({
        band: "strong",
        eligibilityOutcome: "eligible",
        ageHours: 169,
      }),
    ).toBe(false);
  });

  it("adapts only the cold cadence when protected monitoring consumes capacity", () => {
    expect(adaptiveColdCadenceMinutes({ protectedScansPerDay: 500, coldCompanyCount: 50 })).toBe(
      240,
    );
    expect(adaptiveColdCadenceMinutes({ protectedScansPerDay: 900, coldCompanyCount: 50 })).toBe(
      720,
    );
  });
});
