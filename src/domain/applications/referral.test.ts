import { describe, expect, it } from "vitest";
import { assertApplicationReferralOrganization } from "./referral";

describe("application referral integrity", () => {
  it("accepts only referral context for the application company", () => {
    expect(() => assertApplicationReferralOrganization("org-1", "org-1")).not.toThrow();
    expect(() => assertApplicationReferralOrganization("org-1", "org-2")).toThrow(
      /different company/,
    );
    expect(() => assertApplicationReferralOrganization(null, "org-1")).toThrow(/different company/);
  });
});
