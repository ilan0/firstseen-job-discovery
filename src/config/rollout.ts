function enabled(value: string | undefined) {
  return value !== "false";
}

function explicitlyEnabled(value: string | undefined) {
  return value === "true";
}

export function rolloutFlags() {
  return {
    freshnessFeed: enabled(process.env.FRESHNESS_FIRST_FEED_ENABLED),
    companyScopes: enabled(process.env.COMPANY_SCOPE_UI_ENABLED),
    freshnessSlack: enabled(process.env.FRESHNESS_FIRST_SLACK_ENABLED),
    globalSupply: explicitlyEnabled(process.env.GLOBAL_SUPPLY_V2_ENABLED),
    relationshipCrm: explicitlyEnabled(process.env.RELATIONSHIP_CRM_ENABLED),
    applicationWorkflow: explicitlyEnabled(process.env.APPLICATION_WORKFLOW_ENABLED),
    pwa: explicitlyEnabled(process.env.PWA_ENABLED),
    webPush: explicitlyEnabled(process.env.WEB_PUSH_ENABLED),
    individualAuth: explicitlyEnabled(process.env.INDIVIDUAL_AUTH_ENABLED),
    ownerCodeAuth: enabled(process.env.OWNER_CODE_AUTH_ENABLED),
  };
}
