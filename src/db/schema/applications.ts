import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { applicationStage } from "./enums";
import { globalJobs } from "./global-supply";
import { canonicalJobs } from "./jobs";
import { referralRequests } from "./relationships";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const resumeVersions = pgTable(
  "resume_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    label: text("label").notNull(),
    storagePath: text("storage_path").notNull(),
    sourceHash: text("source_hash").notNull(),
    mimeType: text("mime_type").notNull(),
    originalFilename: text("original_filename").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("resume_versions_user_hash_unique").on(table.userId, table.sourceHash),
    check("resume_versions_size_limit", sql`${table.sizeBytes} between 1 and 5242880`),
  ],
);

export const applicationPacketEntries = pgTable(
  "application_packet_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    category: text("category").notNull(),
    label: text("label").notNull(),
    value: text("value").notNull(),
    displayOrder: integer("display_order").default(0).notNull(),
    sensitive: boolean("sensitive").default(false).notNull(),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("application_packet_entries_user_category_label_unique").on(
      table.userId,
      table.category,
      table.label,
    ),
    index("application_packet_entries_user_order_idx").on(table.userId, table.displayOrder),
  ],
);

export const applicationSessions = pgTable(
  "application_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    globalJobId: uuid("global_job_id").references(() => globalJobs.id, { onDelete: "cascade" }),
    legacyJobId: uuid("legacy_job_id").references(() => canonicalJobs.id, {
      onDelete: "cascade",
    }),
    officialUrl: text("official_url").notNull(),
    deviceLabel: text("device_label"),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    disposition: text("disposition").default("opened").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("application_sessions_user_disposition_idx").on(table.userId, table.disposition),
    check(
      "application_sessions_has_job",
      sql`${table.globalJobId} is not null or ${table.legacyJobId} is not null`,
    ),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    globalJobId: uuid("global_job_id").references(() => globalJobs.id, { onDelete: "cascade" }),
    legacyJobId: uuid("legacy_job_id").references(() => canonicalJobs.id, {
      onDelete: "cascade",
    }),
    applicationSessionId: uuid("application_session_id").references(() => applicationSessions.id, {
      onDelete: "set null",
    }),
    resumeVersionId: uuid("resume_version_id").references(() => resumeVersions.id, {
      onDelete: "set null",
    }),
    referralRequestId: uuid("referral_request_id").references(() => referralRequests.id, {
      onDelete: "set null",
    }),
    stage: applicationStage("stage").default("applied").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull(),
    source: text("source").default("manual").notNull(),
    notes: text("notes"),
    inferred: boolean("inferred").default(false).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("applications_user_global_job_unique").on(table.userId, table.globalJobId),
    uniqueIndex("applications_user_legacy_job_unique").on(table.userId, table.legacyJobId),
    index("applications_user_stage_applied_idx").on(table.userId, table.stage, table.appliedAt),
    check(
      "applications_has_job",
      sql`${table.globalJobId} is not null or ${table.legacyJobId} is not null`,
    ),
  ],
);

export const applicationStageHistory = pgTable(
  "application_stage_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    fromStage: applicationStage("from_stage"),
    toStage: applicationStage("to_stage").notNull(),
    reason: text("reason").notNull(),
    inferred: boolean("inferred").default(false).notNull(),
    transitionedAt: timestamp("transitioned_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    index("application_stage_history_app_time_idx").on(table.applicationId, table.transitionedAt),
  ],
);

export const applicationFollowups = pgTable(
  "application_followups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    nextAction: text("next_action").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("application_followups_user_due_idx").on(table.userId, table.dueAt)],
);
