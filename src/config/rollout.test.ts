import { afterEach, describe, expect, it } from "vitest";
import { rolloutFlags } from "./rollout";

const rolloutEnvironment = [
  "FRESHNESS_FIRST_FEED_ENABLED",
  "COMPANY_SCOPE_UI_ENABLED",
  "FRESHNESS_FIRST_SLACK_ENABLED",
  "GLOBAL_SUPPLY_V2_ENABLED",
  "RELATIONSHIP_CRM_ENABLED",
  "APPLICATION_WORKFLOW_ENABLED",
  "PWA_ENABLED",
  "WEB_PUSH_ENABLED",
  "INDIVIDUAL_AUTH_ENABLED",
  "OWNER_CODE_AUTH_ENABLED",
] as const;

const originalValues = new Map(
  rolloutEnvironment.map((name) => [name, process.env[name]] as const),
);

afterEach(() => {
  for (const name of rolloutEnvironment) {
    const value = originalValues.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("rollout flags", () => {
  it("keeps additive daily-driver features disabled by default", () => {
    for (const name of rolloutEnvironment) delete process.env[name];

    expect(rolloutFlags()).toMatchObject({
      globalSupply: false,
      relationshipCrm: false,
      applicationWorkflow: false,
      pwa: false,
      webPush: false,
      individualAuth: false,
      ownerCodeAuth: true,
    });
  });

  it("enables guarded features only for the exact true value", () => {
    process.env.GLOBAL_SUPPLY_V2_ENABLED = "TRUE";
    process.env.RELATIONSHIP_CRM_ENABLED = "1";
    process.env.APPLICATION_WORKFLOW_ENABLED = "yes";
    process.env.PWA_ENABLED = "false";
    process.env.WEB_PUSH_ENABLED = "true";

    expect(rolloutFlags()).toMatchObject({
      globalSupply: false,
      relationshipCrm: false,
      applicationWorkflow: false,
      pwa: false,
      webPush: true,
    });
  });

  it("allows legacy defaults to be explicitly disabled", () => {
    process.env.FRESHNESS_FIRST_FEED_ENABLED = "false";
    process.env.COMPANY_SCOPE_UI_ENABLED = "false";
    process.env.FRESHNESS_FIRST_SLACK_ENABLED = "false";
    process.env.OWNER_CODE_AUTH_ENABLED = "false";

    expect(rolloutFlags()).toMatchObject({
      freshnessFeed: false,
      companyScopes: false,
      freshnessSlack: false,
      ownerCodeAuth: false,
    });
  });
});
