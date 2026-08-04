import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  analysisStatus,
  confidenceLevel,
  connectorKind,
  eligibilityOutcome,
  jobLifecycleStatus,
  monitoringTier,
  observationStatus,
  outboxStatus,
  queueStatus,
  recommendationBand,
  rankingDimension,
  runStatus,
} from "./enums";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    canonicalDomain: text("canonical_domain"),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("organizations_normalized_domain_unique").on(
      table.normalizedName,
      table.canonicalDomain,
    ),
  ],
);

export const organizationDomains = pgTable(
  "organization_domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    authorityConfidence: integer("authority_confidence").default(0).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    evidence: jsonb("evidence").default({}).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("organization_domains_domain_unique").on(table.domain),
    index("organization_domains_org_idx").on(table.organizationId),
    check(
      "organization_domains_authority_range",
      sql`${table.authorityConfidence} between 0 and 100`,
    ),
  ],
);

export const globalCareerSources = pgTable(
  "global_career_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectorKind: connectorKind("connector_kind").notNull(),
    tenantId: text("tenant_id"),
    baseUrl: text("base_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    publicConfig: jsonb("public_config").default({}).notNull(),
    active: boolean("active").default(true).notNull(),
    parsingConfidence: integer("parsing_confidence").default(0).notNull(),
    etag: text("etag"),
    lastModified: text("last_modified"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("global_career_sources_url_unique").on(table.normalizedUrl),
    uniqueIndex("global_career_sources_provider_tenant_unique").on(
      table.connectorKind,
      table.tenantId,
    ),
    check(
      "global_career_sources_confidence_range",
      sql`${table.parsingConfidence} between 0 and 100`,
    ),
  ],
);

export const globalSourcePolicies = pgTable(
  "global_source_policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    careerSourceId: uuid("career_source_id").references(() => globalCareerSources.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").notNull(),
    policyVersion: text("policy_version").notNull(),
    status: text("status").notNull(),
    mayRequest: boolean("may_request").default(false).notNull(),
    mayUseTransiently: boolean("may_use_transiently").default(false).notNull(),
    mayPersist: boolean("may_persist").default(false).notNull(),
    mayDisplay: boolean("may_display").default(false).notNull(),
    mayResolveRedirects: boolean("may_resolve_redirects").default(false).notNull(),
    termsUrl: text("terms_url"),
    robotsEvidence: jsonb("robots_evidence").default({}).notNull(),
    allowedPaths: text("allowed_paths")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    expectedOrganization: text("expected_organization"),
    closureMethod: text("closure_method"),
    retentionDays: integer("retention_days"),
    reviewedBy: text("reviewed_by"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("global_source_policies_provider_version_unique").on(
      table.provider,
      table.policyVersion,
      table.careerSourceId,
    ),
  ],
);

export const globalScanSchedules = pgTable(
  "global_scan_schedules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    careerSourceId: uuid("career_source_id")
      .notNull()
      .references(() => globalCareerSources.id, { onDelete: "cascade" }),
    monitoringTier: monitoringTier("monitoring_tier").default("cold").notNull(),
    cadenceMinutes: integer("cadence_minutes").default(240).notNull(),
    active: boolean("active").default(true).notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).defaultNow().notNull(),
    leasedUntil: timestamp("leased_until", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    demandVersion: integer("demand_version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("global_scan_schedules_source_unique").on(table.careerSourceId),
    index("global_scan_schedules_due_idx").on(table.active, table.nextRunAt),
    check("global_scan_schedules_cadence_minimum", sql`${table.cadenceMinutes} >= 15`),
  ],
);

export const globalScanRuns = pgTable(
  "global_scan_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    careerSourceId: uuid("career_source_id")
      .notNull()
      .references(() => globalCareerSources.id, { onDelete: "cascade" }),
    scheduleId: uuid("schedule_id").references(() => globalScanSchedules.id, {
      onDelete: "set null",
    }),
    status: runStatus("status").default("queued").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    complete: boolean("complete").default(false).notNull(),
    observationCount: integer("observation_count").default(0).notNull(),
    errorCode: text("error_code"),
    metrics: jsonb("metrics").default({}).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("global_scan_runs_idempotency_unique").on(table.idempotencyKey),
    index("global_scan_runs_source_time_idx").on(table.careerSourceId, table.scheduledFor),
  ],
);

export const globalOutboxEvents = pgTable(
  "global_outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanRunId: uuid("scan_run_id")
      .notNull()
      .references(() => globalScanRuns.id, { onDelete: "cascade" }),
    eventName: text("event_name").notNull(),
    aggregateId: uuid("aggregate_id")
      .notNull()
      .references(() => globalCareerSources.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").notNull(),
    status: outboxStatus("status").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("global_outbox_events_idempotency_unique").on(table.idempotencyKey),
    index("global_outbox_events_dispatch_idx").on(table.status, table.availableAt, table.id),
  ],
);

export const globalRawObservations = pgTable(
  "global_raw_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanRunId: uuid("scan_run_id").references(() => globalScanRuns.id, {
      onDelete: "set null",
    }),
    careerSourceId: uuid("career_source_id")
      .notNull()
      .references(() => globalCareerSources.id, { onDelete: "cascade" }),
    externalJobId: text("external_job_id"),
    officialUrl: text("official_url").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
    status: observationStatus("status").notNull(),
    contentHash: text("content_hash").notNull(),
    normalizedPayload: jsonb("normalized_payload").default({}).notNull(),
    sanitizedBody: text("sanitized_body"),
    responseMetadata: jsonb("response_metadata").default({}).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("global_observations_source_hash_time_unique").on(
      table.careerSourceId,
      table.contentHash,
      table.observedAt,
    ),
    index("global_observations_source_time_idx").on(table.careerSourceId, table.observedAt),
  ],
);

export const globalJobs = pgTable(
  "global_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    authoritativeSourceId: uuid("authoritative_source_id")
      .notNull()
      .references(() => globalCareerSources.id, { onDelete: "restrict" }),
    externalJobId: text("external_job_id"),
    requisitionId: text("requisition_id"),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    officialUrl: text("official_url").notNull(),
    normalizedOfficialUrl: text("normalized_official_url").notNull(),
    applyUrl: text("apply_url").notNull(),
    lifecycleStatus: jobLifecycleStatus("lifecycle_status").default("open").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedAtConfidence: confidenceLevel("posted_at_confidence").default("low").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    possiblyClosedAt: timestamp("possibly_closed_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    currentSnapshotId: uuid("current_snapshot_id"),
    currentMaterialHash: text("current_material_hash"),
    consecutiveSuccessfulMisses: integer("consecutive_successful_misses").default(0).notNull(),
    rowVersion: integer("row_version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("global_jobs_official_url_unique").on(table.normalizedOfficialUrl),
    index("global_jobs_org_external_idx").on(table.organizationId, table.externalJobId),
    index("global_jobs_lifecycle_posted_idx").on(table.lifecycleStatus, table.postedAt),
    check("global_jobs_misses_nonnegative", sql`${table.consecutiveSuccessfulMisses} >= 0`),
  ],
);

export const globalJobSourceLinks = pgTable(
  "global_job_source_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => globalJobs.id, { onDelete: "cascade" }),
    careerSourceId: uuid("career_source_id")
      .notNull()
      .references(() => globalCareerSources.id, { onDelete: "cascade" }),
    externalJobId: text("external_job_id"),
    sourceUrl: text("source_url").notNull(),
    authoritative: boolean("authoritative").default(false).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("global_job_source_links_job_source_unique").on(table.jobId, table.careerSourceId),
  ],
);

export const globalJobSnapshots = pgTable(
  "global_job_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => globalJobs.id, { onDelete: "cascade" }),
    observationId: uuid("observation_id").references(() => globalRawObservations.id, {
      onDelete: "set null",
    }),
    materialHash: text("material_hash").notNull(),
    descriptionText: text("description_text").notNull(),
    normalizedFacts: jsonb("normalized_facts").default({}).notNull(),
    materialChangeReasons: text("material_change_reasons")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("global_job_snapshots_job_hash_unique").on(table.jobId, table.materialHash),
    index("global_job_snapshots_job_time_idx").on(table.jobId, table.capturedAt),
  ],
);

export const globalJobFingerprints = pgTable(
  "global_job_fingerprints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => globalJobs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    fingerprint: text("fingerprint").notNull(),
    confidence: integer("confidence").notNull(),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("global_job_fingerprints_kind_hash_unique").on(table.kind, table.fingerprint),
    check("global_job_fingerprints_confidence_range", sql`${table.confidence} between 0 and 100`),
  ],
);

export const globalJobLifecycleEvents = pgTable(
  "global_job_lifecycle_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => globalJobs.id, { onDelete: "cascade" }),
    fromStatus: jobLifecycleStatus("from_status"),
    toStatus: jobLifecycleStatus("to_status").notNull(),
    reason: text("reason").notNull(),
    evidence: jsonb("evidence").default({}).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("global_lifecycle_events_job_time_idx").on(table.jobId, table.occurredAt)],
);

export const jobRequirementExtractions = pgTable(
  "job_requirement_extractions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => globalJobSnapshots.id, { onDelete: "cascade" }),
    status: analysisStatus("status").default("pending").notNull(),
    model: text("model").notNull(),
    escalationModel: text("escalation_model"),
    unresolvedFields: text("unresolved_fields")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    schemaVersion: text("schema_version").notNull(),
    promptHash: text("prompt_hash").notNull(),
    extractionVersion: text("extraction_version").notNull(),
    structuredOutput: jsonb("structured_output"),
    confidence: integer("confidence"),
    inputTokens: integer("input_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }),
    actualCostUsd: numeric("actual_cost_usd", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("job_requirement_extractions_cache_unique").on(
      table.snapshotId,
      table.model,
      table.schemaVersion,
      table.promptHash,
      table.extractionVersion,
    ),
    check(
      "job_requirement_extractions_confidence_range",
      sql`${table.confidence} is null or ${table.confidence} between 0 and 100`,
    ),
  ],
);

export const userCompanyFollows = pgTable(
  "user_company_follows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    interested: boolean("interested").default(false).notNull(),
    scope: text("scope").default("discovered").notNull(),
    active: boolean("active").default(true).notNull(),
    stickyDismissed: boolean("sticky_dismissed").default(false).notNull(),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("user_company_follows_user_org_unique").on(table.userId, table.organizationId),
    index("user_company_follows_user_scope_idx").on(table.userId, table.scope),
  ],
);

export const userJobEligibility = pgTable(
  "user_job_eligibility",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => globalJobs.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => globalJobSnapshots.id, { onDelete: "cascade" }),
    extractionId: uuid("extraction_id").references(() => jobRequirementExtractions.id, {
      onDelete: "set null",
    }),
    outcome: eligibilityOutcome("outcome").notNull(),
    ruleVersion: text("rule_version").notNull(),
    reasons: jsonb("reasons").default([]).notNull(),
    evidence: jsonb("evidence").default([]).notNull(),
    uncertainFields: text("uncertain_fields")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("user_job_eligibility_user_snapshot_rule_unique").on(
      table.userId,
      table.snapshotId,
      table.ruleVersion,
    ),
  ],
);

export const userJobRankingDimensions = pgTable(
  "user_job_ranking_dimensions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => globalJobs.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => globalJobSnapshots.id, { onDelete: "cascade" }),
    dimension: rankingDimension("dimension").notNull(),
    value: integer("value").notNull(),
    confidence: integer("confidence").notNull(),
    explanation: text("explanation").notNull(),
    evidence: jsonb("evidence").default([]).notNull(),
    rankingVersion: text("ranking_version").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("user_job_dimensions_user_snapshot_dimension_version_unique").on(
      table.userId,
      table.snapshotId,
      table.dimension,
      table.rankingVersion,
    ),
    check("user_job_dimensions_value_range", sql`${table.value} between 0 and 100`),
    check("user_job_dimensions_confidence_range", sql`${table.confidence} between 0 and 100`),
  ],
);

export const userRecommendations = pgTable(
  "user_recommendations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => globalJobs.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => globalJobSnapshots.id, { onDelete: "cascade" }),
    eligibilityId: uuid("eligibility_id")
      .notNull()
      .references(() => userJobEligibility.id, { onDelete: "cascade" }),
    band: recommendationBand("band").notNull(),
    urgency: integer("urgency").notNull(),
    headline: text("headline").notNull(),
    strengths: jsonb("strengths").default([]).notNull(),
    weaknesses: jsonb("weaknesses").default([]).notNull(),
    primaryConcern: text("primary_concern"),
    rankingVersion: text("ranking_version").notNull(),
    active: boolean("active").default(true).notNull(),
    recommendedAt: timestamp("recommended_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("user_recommendations_user_snapshot_version_unique").on(
      table.userId,
      table.snapshotId,
      table.rankingVersion,
    ),
    index("user_recommendations_feed_idx").on(table.userId, table.active, table.band),
    check("user_recommendations_urgency_range", sql`${table.urgency} between 0 and 100`),
  ],
);

export const userJobQueueStates = pgTable(
  "user_job_queue_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => globalJobs.id, { onDelete: "cascade" }),
    status: queueStatus("status").default("active").notNull(),
    rowVersion: integer("row_version").default(1).notNull(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("user_job_queue_states_user_job_unique").on(table.userId, table.jobId),
    index("user_job_queue_states_user_status_idx").on(table.userId, table.status),
  ],
);
