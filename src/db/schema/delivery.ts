import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  companyAlertMode,
  deliveryStatus,
  notificationAlertPreset,
  notificationChannelKind,
} from "./enums";
import { globalJobs, organizations } from "./global-supply";
import { notifications } from "./operations";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    kind: notificationChannelKind("kind").notNull(),
    label: text("label").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    configurationEncrypted: text("configuration_encrypted"),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("notification_channels_user_kind_label_unique").on(
      table.userId,
      table.kind,
      table.label,
    ),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    enabled: boolean("enabled").default(true).notNull(),
    alertPreset: notificationAlertPreset("alert_preset").default("balanced").notNull(),
    immediateHot: boolean("immediate_hot").default(true).notNull(),
    immediateStrong: boolean("immediate_strong").default(true).notNull(),
    immediatePossible: boolean("immediate_possible").default(true).notNull(),
    referralCompany: boolean("referral_company").default(true).notNull(),
    interestedCompany: boolean("interested_company").default(true).notNull(),
    hotStrongMaxAgeHours: integer("hot_strong_max_age_hours").default(24).notNull(),
    possibleMaxAgeHours: integer("possible_max_age_hours").default(6).notNull(),
    roleFamilies: text("role_families")
      .array()
      .default(sql`ARRAY['general_swe','full_stack','backend','frontend','ai_engineering']::text[]`)
      .notNull(),
    quietHoursEnabled: boolean("quiet_hours_enabled").default(true).notNull(),
    companyOverrideMode: companyAlertMode("company_override_mode"),
    policyVersion: text("policy_version").default("2026-08-05.1").notNull(),
    digest: boolean("digest").default(true).notNull(),
    detailedLockScreen: boolean("detailed_lock_screen").default(false).notNull(),
    quietHoursStart: integer("quiet_hours_start").default(22).notNull(),
    quietHoursEnd: integer("quiet_hours_end").default(7).notNull(),
    timezone: text("timezone").default("America/New_York").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("notification_preferences_channel_global_unique")
      .on(table.channelId)
      .where(sql`${table.organizationId} is null`),
    uniqueIndex("notification_preferences_channel_org_unique")
      .on(table.channelId, table.organizationId)
      .where(sql`${table.organizationId} is not null`),
  ],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
    endpointHash: text("endpoint_hash").notNull(),
    encryptedCapability: text("encrypted_capability").notNull(),
    userAgentSafe: text("user_agent_safe"),
    deviceLabel: text("device_label"),
    expirationTime: timestamp("expiration_time", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    failureCount: integer("failure_count").default(0).notNull(),
    detailedLockScreen: boolean("detailed_lock_screen").default(false).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_hash_unique").on(table.endpointHash),
    index("push_subscriptions_user_active_idx").on(table.userId, table.revokedAt),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    logicalNotificationId: uuid("logical_notification_id").references(() => notifications.id, {
      onDelete: "cascade",
    }),
    globalJobId: uuid("global_job_id").references(() => globalJobs.id, {
      onDelete: "cascade",
    }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
    pushSubscriptionId: uuid("push_subscription_id").references(() => pushSubscriptions.id, {
      onDelete: "set null",
    }),
    reason: text("reason").notNull(),
    policyVersion: text("policy_version").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: deliveryStatus("status").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    providerResponseSafe: jsonb("provider_response_safe").default({}).notNull(),
    lastErrorCode: text("last_error_code"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("notification_deliveries_idempotency_unique").on(table.idempotencyKey),
    index("notification_deliveries_retry_idx").on(table.status, table.nextAttemptAt),
  ],
);

export const notificationReads = pgTable(
  "notification_reads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    logicalNotificationId: uuid("logical_notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("notification_reads_user_logical_unique").on(
      table.userId,
      table.logicalNotificationId,
    ),
  ],
);
