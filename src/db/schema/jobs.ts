import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { careerSources, companies } from "./sources";
import {
  confidenceLevel,
  employmentType,
  jobLifecycleStatus,
  observationStatus,
  runStatus,
  scheduleKind,
} from "./enums";
import { globalJobs, globalJobSnapshots } from "./global-supply";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const scanSchedules = pgTable(
  "scan_schedules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    kind: scheduleKind("kind").notNull(),
    careerSourceId: uuid("career_source_id").references(() => careerSources.id, {
      onDelete: "cascade",
    }),
    cadenceMinutes: integer("cadence_minutes").notNull(),
    active: boolean("active").default(true).notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).defaultNow().notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("scan_schedules_due_idx").on(table.active, table.nextRunAt),
    check("scan_schedules_cadence_minimum", sql`${table.cadenceMinutes} >= 10`),
  ],
);

export const scanRuns = pgTable(
  "scan_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    scheduleId: uuid("schedule_id").references(() => scanSchedules.id, { onDelete: "set null" }),
    kind: scheduleKind("kind").notNull(),
    status: runStatus("status").default("queued").notNull(),
    trigger: text("trigger").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    sourceCount: integer("source_count").default(0).notNull(),
    discoveredCount: integer("discovered_count").default(0).notNull(),
    changedCount: integer("changed_count").default(0).notNull(),
    failureCount: integer("failure_count").default(0).notNull(),
    summary: jsonb("summary").default({}).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("scan_runs_idempotency_unique").on(table.idempotencyKey),
    index("scan_runs_user_scheduled_idx").on(table.userId, table.scheduledFor),
  ],
);

export const scanSourceRuns = pgTable(
  "scan_source_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    scanRunId: uuid("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    careerSourceId: uuid("career_source_id")
      .notNull()
      .references(() => careerSources.id, { onDelete: "cascade" }),
    status: runStatus("status").default("queued").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    responseStatus: integer("response_status"),
    observationCount: integer("observation_count").default(0).notNull(),
    errorCode: text("error_code"),
    errorMessageSafe: text("error_message_safe"),
    metrics: jsonb("metrics").default({}).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("scan_source_runs_scan_source_unique").on(table.scanRunId, table.careerSourceId),
    index("scan_source_runs_source_created_idx").on(table.careerSourceId, table.createdAt),
  ],
);

export const rawObservations = pgTable(
  "raw_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    scanSourceRunId: uuid("scan_source_run_id").references(() => scanSourceRuns.id, {
      onDelete: "set null",
    }),
    careerSourceId: uuid("career_source_id")
      .notNull()
      .references(() => careerSources.id, { onDelete: "cascade" }),
    externalJobId: text("external_job_id"),
    officialUrl: text("official_url").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
    status: observationStatus("status").notNull(),
    httpStatus: integer("http_status"),
    contentType: text("content_type"),
    contentHash: text("content_hash").notNull(),
    responseMetadata: jsonb("response_metadata").default({}).notNull(),
    normalizedPayload: jsonb("normalized_payload").default({}).notNull(),
    sanitizedBody: text("sanitized_body"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("raw_observations_source_hash_time_unique").on(
      table.careerSourceId,
      table.contentHash,
      table.observedAt,
    ),
    index("raw_observations_source_observed_idx").on(table.careerSourceId, table.observedAt),
  ],
);

export const canonicalJobs = pgTable(
  "canonical_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    authoritativeSourceId: uuid("authoritative_source_id")
      .notNull()
      .references(() => careerSources.id, { onDelete: "restrict" }),
    externalJobId: text("external_job_id"),
    requisitionId: text("requisition_id"),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    employmentType: employmentType("employment_type").default("unknown").notNull(),
    officialUrl: text("official_url").notNull(),
    normalizedOfficialUrl: text("normalized_official_url").notNull(),
    lifecycleStatus: jobLifecycleStatus("lifecycle_status")
      .default("pending_verification")
      .notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedAtConfidence: confidenceLevel("posted_at_confidence").default("low").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    possiblyClosedAt: timestamp("possibly_closed_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    consecutiveSuccessfulMisses: integer("consecutive_successful_misses").default(0).notNull(),
    currentMaterialHash: text("current_material_hash"),
    rowVersion: integer("row_version").default(1).notNull(),
    globalJobId: uuid("global_job_id").references(() => globalJobs.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("canonical_jobs_user_url_unique").on(table.userId, table.normalizedOfficialUrl),
    index("canonical_jobs_user_lifecycle_idx").on(table.userId, table.lifecycleStatus),
    index("canonical_jobs_company_external_idx").on(table.companyId, table.externalJobId),
    index("canonical_jobs_last_seen_idx").on(table.lastSeenAt),
    check("canonical_jobs_misses_nonnegative", sql`${table.consecutiveSuccessfulMisses} >= 0`),
  ],
);

export const jobSourceLinks = pgTable(
  "job_source_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => canonicalJobs.id, { onDelete: "cascade" }),
    careerSourceId: uuid("career_source_id")
      .notNull()
      .references(() => careerSources.id, { onDelete: "cascade" }),
    externalJobId: text("external_job_id"),
    sourceUrl: text("source_url").notNull(),
    authoritative: boolean("authoritative").default(false).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("job_source_links_job_source_unique").on(table.jobId, table.careerSourceId),
  ],
);

export const jobDescriptionSnapshots = pgTable(
  "job_description_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => canonicalJobs.id, { onDelete: "cascade" }),
    observationId: uuid("observation_id").references(() => rawObservations.id, {
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
    globalSnapshotId: uuid("global_snapshot_id").references(() => globalJobSnapshots.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("job_snapshots_job_hash_unique").on(table.jobId, table.materialHash),
    index("job_snapshots_job_captured_idx").on(table.jobId, table.capturedAt),
  ],
);

export const dedupeFingerprints = pgTable(
  "dedupe_fingerprints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => canonicalJobs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    fingerprint: text("fingerprint").notNull(),
    confidence: integer("confidence").notNull(),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("dedupe_fingerprints_user_kind_hash_unique").on(
      table.userId,
      table.kind,
      table.fingerprint,
    ),
    check("dedupe_fingerprints_confidence_range", sql`${table.confidence} between 0 and 100`),
  ],
);
