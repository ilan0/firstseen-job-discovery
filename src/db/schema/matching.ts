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
  actionKind,
  analysisStatus,
  eligibilityOutcome,
  queueStatus,
  rankingDimension,
  recommendationBand,
} from "./enums";
import { canonicalJobs, jobDescriptionSnapshots } from "./jobs";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const eligibilityDecisions = pgTable(
  "eligibility_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => canonicalJobs.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => jobDescriptionSnapshots.id, { onDelete: "cascade" }),
    outcome: eligibilityOutcome("outcome").notNull(),
    ruleVersion: text("rule_version").notNull(),
    normalizedFacts: jsonb("normalized_facts").default({}).notNull(),
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
    uniqueIndex("eligibility_decisions_snapshot_rule_unique").on(
      table.snapshotId,
      table.ruleVersion,
    ),
    index("eligibility_decisions_job_evaluated_idx").on(table.jobId, table.evaluatedAt),
  ],
);

export const aiAnalyses = pgTable(
  "ai_analyses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => canonicalJobs.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => jobDescriptionSnapshots.id, { onDelete: "cascade" }),
    status: analysisStatus("status").default("pending").notNull(),
    model: text("model").notNull(),
    schemaVersion: text("schema_version").notNull(),
    promptHash: text("prompt_hash").notNull(),
    structuredOutput: jsonb("structured_output"),
    refusalReasonSafe: text("refusal_reason_safe"),
    errorCode: text("error_code"),
    inputTokens: integer("input_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("ai_analyses_snapshot_schema_prompt_unique").on(
      table.snapshotId,
      table.schemaVersion,
      table.promptHash,
    ),
    index("ai_analyses_job_created_idx").on(table.jobId, table.createdAt),
  ],
);

export const rankingDimensions = pgTable(
  "ranking_dimensions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => canonicalJobs.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => jobDescriptionSnapshots.id, { onDelete: "cascade" }),
    dimension: rankingDimension("dimension").notNull(),
    value: integer("value").notNull(),
    confidence: integer("confidence").notNull(),
    evidence: jsonb("evidence").default([]).notNull(),
    explanation: text("explanation").notNull(),
    rankingVersion: text("ranking_version").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("ranking_dimensions_snapshot_dimension_version_unique").on(
      table.snapshotId,
      table.dimension,
      table.rankingVersion,
    ),
    check("ranking_dimensions_value_range", sql`${table.value} between 0 and 100`),
    check("ranking_dimensions_confidence_range", sql`${table.confidence} between 0 and 100`),
  ],
);

export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => canonicalJobs.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => jobDescriptionSnapshots.id, { onDelete: "cascade" }),
    eligibilityDecisionId: uuid("eligibility_decision_id")
      .notNull()
      .references(() => eligibilityDecisions.id, { onDelete: "cascade" }),
    band: recommendationBand("band").notNull(),
    urgency: integer("urgency").notNull(),
    headline: text("headline").notNull(),
    strengths: jsonb("strengths").default([]).notNull(),
    weaknesses: jsonb("weaknesses").default([]).notNull(),
    routingReasons: jsonb("routing_reasons").default([]).notNull(),
    rankingVersion: text("ranking_version").notNull(),
    active: boolean("active").default(true).notNull(),
    recommendedAt: timestamp("recommended_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("recommendations_snapshot_ranking_version_unique").on(
      table.snapshotId,
      table.rankingVersion,
    ),
    index("recommendations_user_band_time_idx").on(table.userId, table.band, table.recommendedAt),
    check("recommendations_urgency_range", sql`${table.urgency} between 0 and 100`),
  ],
);

export const queueStates = pgTable(
  "queue_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => canonicalJobs.id, { onDelete: "cascade" }),
    status: queueStatus("status").default("active").notNull(),
    rowVersion: integer("row_version").default(1).notNull(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("queue_states_user_job_unique").on(table.userId, table.jobId)],
);

export const queueStateHistory = pgTable(
  "queue_state_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => canonicalJobs.id, { onDelete: "cascade" }),
    fromStatus: queueStatus("from_status"),
    toStatus: queueStatus("to_status").notNull(),
    actionId: uuid("action_id"),
    reason: text("reason").notNull(),
    transitionedAt: timestamp("transitioned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("queue_state_history_job_time_idx").on(table.jobId, table.transitionedAt)],
);

export const userActions = pgTable(
  "user_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => canonicalJobs.id, { onDelete: "cascade" }),
    kind: actionKind("kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("user_actions_idempotency_unique").on(table.userId, table.idempotencyKey),
    index("user_actions_job_time_idx").on(table.jobId, table.occurredAt),
  ],
);
