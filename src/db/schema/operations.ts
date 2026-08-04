import { sql } from "drizzle-orm";
import {
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
import { canonicalJobs, jobDescriptionSnapshots, scanRuns } from "./jobs";
import { costProvider, deliveryStatus, notificationKind, outboxStatus, runStatus } from "./enums";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    jobId: uuid("job_id").references(() => canonicalJobs.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id").references(() => jobDescriptionSnapshots.id, {
      onDelete: "cascade",
    }),
    kind: notificationKind("kind").notNull(),
    status: deliveryStatus("status").default("pending").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    payload: jsonb("payload").default({}).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    deferredUntil: timestamp("deferred_until", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    providerResponseSafe: jsonb("provider_response_safe").default({}).notNull(),
    lastErrorCode: text("last_error_code"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("notifications_idempotency_unique").on(table.userId, table.idempotencyKey),
    index("notifications_status_deferred_idx").on(table.status, table.deferredUntil),
  ],
);

export const digestDeliveries = pgTable(
  "digest_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    localDate: text("local_date").notNull(),
    timezone: text("timezone").notNull(),
    status: deliveryStatus("status").default("pending").notNull(),
    notificationId: uuid("notification_id").references(() => notifications.id, {
      onDelete: "set null",
    }),
    jobIds: uuid("job_ids")
      .array()
      .default(sql`ARRAY[]::uuid[]`)
      .notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("digest_deliveries_user_local_date_unique").on(table.userId, table.localDate),
  ],
);

export const workerAttempts = pgTable(
  "worker_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    workflowName: text("workflow_name").notNull(),
    eventId: text("event_id").notNull(),
    stepName: text("step_name"),
    status: runStatus("status").default("queued").notNull(),
    attemptNumber: integer("attempt_number").default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessageSafe: text("error_message_safe"),
    traceId: text("trace_id"),
    metrics: jsonb("metrics").default({}).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("worker_attempts_event_step_attempt_unique").on(
      table.eventId,
      table.stepName,
      table.attemptNumber,
    ),
    index("worker_attempts_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const deadLetterRecords = pgTable(
  "dead_letter_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    workflowName: text("workflow_name").notNull(),
    eventId: text("event_id").notNull(),
    eventName: text("event_name").notNull(),
    eventPayload: jsonb("event_payload").notNull(),
    errorCode: text("error_code").notNull(),
    errorMessageSafe: text("error_message_safe").notNull(),
    failedAt: timestamp("failed_at", { withTimezone: true }).defaultNow().notNull(),
    replayedAt: timestamp("replayed_at", { withTimezone: true }),
    replayEventId: text("replay_event_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("dead_letter_records_event_unique").on(table.eventId),
    index("dead_letter_records_unresolved_idx").on(table.resolvedAt, table.failedAt),
  ],
);

export const usageCostLedger = pgTable(
  "usage_cost_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    provider: costProvider("provider").notNull(),
    operation: text("operation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    units: numeric("units", { precision: 18, scale: 6 }).default("0").notNull(),
    unitName: text("unit_name").notNull(),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 })
      .default("0")
      .notNull(),
    actualCostUsd: numeric("actual_cost_usd", { precision: 12, scale: 6 }),
    reservationStatus: text("reservation_status").default("reserved").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("usage_cost_ledger_idempotency_unique").on(table.userId, table.idempotencyKey),
    index("usage_cost_ledger_provider_time_idx").on(table.provider, table.occurredAt),
    check("usage_cost_ledger_estimated_nonnegative", sql`${table.estimatedCostUsd} >= 0`),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    eventName: text("event_name").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").notNull(),
    status: outboxStatus("status").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    leasedUntil: timestamp("leased_until", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("outbox_events_idempotency_unique").on(table.idempotencyKey),
    index("outbox_events_dispatch_idx").on(table.status, table.availableAt),
  ],
);

export const retryRecords = pgTable(
  "retry_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    scanRunId: uuid("scan_run_id").references(() => scanRuns.id, { onDelete: "cascade" }),
    operationType: text("operation_type").notNull(),
    operationKey: text("operation_key").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    lastErrorCode: text("last_error_code").notNull(),
    exhaustedAt: timestamp("exhausted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("retry_records_operation_unique").on(
      table.userId,
      table.operationType,
      table.operationKey,
    ),
    index("retry_records_due_idx").on(table.exhaustedAt, table.nextAttemptAt),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    eventType: text("event_type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    metadataSafe: jsonb("metadata_safe").default({}).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_events_user_time_idx").on(table.userId, table.occurredAt)],
);

// System-owned, short-lived counters. Identifiers are HMACed before persistence and browser roles
// receive no grants, so these records are neither enumerable nor reversible through the app.
export const securityRateLimits = pgTable(
  "security_rate_limits",
  {
    keyHash: text("key_hash").primaryKey(),
    namespace: text("namespace").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").default(1).notNull(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("security_rate_limits_expiry_idx").on(table.windowStartedAt, table.blockedUntil),
    check("security_rate_limits_count_positive", sql`${table.requestCount} > 0`),
  ],
);

// Service-only outbox for private objects that must be removed after account
// deletion even when the external storage provider is temporarily unavailable.
export const storageCleanupRecords = pgTable(
  "storage_cleanup_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bucket: text("bucket").notNull(),
    objectPath: text("object_path").notNull(),
    reason: text("reason").notNull(),
    status: text("status").default("waiting").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
    lastErrorCode: text("last_error_code"),
    cleanedAt: timestamp("cleaned_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("storage_cleanup_bucket_path_unique").on(table.bucket, table.objectPath),
    index("storage_cleanup_due_idx").on(table.status, table.nextAttemptAt),
    check("storage_cleanup_attempts_nonnegative", sql`${table.attemptCount} >= 0`),
    check(
      "storage_cleanup_status_valid",
      sql`${table.status} in ('waiting', 'pending', 'processing', 'failed', 'cleaned')`,
    ),
  ],
);
