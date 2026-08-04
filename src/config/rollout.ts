function enabled(value: string | undefined) {
  return value !== "false";
}

export function rolloutFlags() {
  return {
    freshnessFeed: enabled(process.env.FRESHNESS_FIRST_FEED_ENABLED),
    companyScopes: enabled(process.env.COMPANY_SCOPE_UI_ENABLED),
    freshnessSlack: enabled(process.env.FRESHNESS_FIRST_SLACK_ENABLED),
  };
}
