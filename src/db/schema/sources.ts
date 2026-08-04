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
import {
  companyOrigin,
  connectorKind,
  monitoringTier,
  policyStatus,
  referralStatus,
  watchlistScope,
} from "./enums";
import { globalCareerSources, organizations } from "./global-supply";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    domain: text("domain"),
    origin: companyOrigin("origin").notNull(),
    priority: integer("priority").default(3).notNull(),
    notes: text("notes"),
    provisional: boolean("provisional").default(false).notNull(),
    interested: boolean("interested").default(false).notNull(),
    active: boolean("active").default(true).notNull(),
    discoveryEvidence: jsonb("discovery_evidence").default({}).notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("companies_user_organization_unique")
      .on(table.userId, table.organizationId)
      .where(sql`${table.organizationId} is not null`),
    uniqueIndex("companies_user_legacy_name_unique")
      .on(table.userId, table.normalizedName)
      .where(sql`${table.organizationId} is null`),
    index("companies_user_priority_idx").on(table.userId, table.priority),
    check("companies_priority_range", sql`${table.priority} between 1 and 5`),
  ],
);

export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    personName: text("person_name").notNull(),
    personTitle: text("person_title"),
    relationship: text("relationship"),
    status: referralStatus("status").default("available").notNull(),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [index("referrals_user_company_idx").on(table.userId, table.companyId)],
);

export const watchlists = pgTable(
  "watchlists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    active: boolean("active").default(true).notNull(),
    scope: watchlistScope("scope").default("personal").notNull(),
    monitoringTier: monitoringTier("monitoring_tier").default("standard").notNull(),
    cadenceMinutes: integer("cadence_minutes").default(60).notNull(),
    nextScanAt: timestamp("next_scan_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("watchlists_user_company_unique").on(table.userId, table.companyId),
    index("watchlists_due_idx").on(table.active, table.nextScanAt),
    index("watchlists_user_scope_idx").on(table.userId, table.scope),
    check("watchlists_cadence_minimum", sql`${table.cadenceMinutes} >= 15`),
  ],
);

export const connectorDefinitions = pgTable("connector_definitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: connectorKind("kind").notNull().unique(),
  displayName: text("display_name").notNull(),
  capabilities: jsonb("capabilities").default({}).notNull(),
  defaultRateLimit: jsonb("default_rate_limit").default({}).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  ...timestamps,
});

export const careerSources = pgTable(
  "career_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    connectorKind: connectorKind("connector_kind").notNull(),
    baseUrl: text("base_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    publicConfig: jsonb("public_config").default({}).notNull(),
    active: boolean("active").default(true).notNull(),
    parsingConfidence: integer("parsing_confidence").default(0).notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    globalSourceId: uuid("global_source_id").references(() => globalCareerSources.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("career_sources_user_url_unique").on(table.userId, table.normalizedUrl),
    index("career_sources_company_idx").on(table.companyId),
    check("career_sources_confidence_range", sql`${table.parsingConfidence} between 0 and 100`),
  ],
);

export const connectorRegistrations = pgTable(
  "connector_registrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    careerSourceId: uuid("career_source_id")
      .notNull()
      .references(() => careerSources.id, { onDelete: "cascade" }),
    externalTenantId: text("external_tenant_id"),
    cursorState: jsonb("cursor_state").default({}).notNull(),
    etag: text("etag"),
    lastModified: text("last_modified"),
    connectorVersion: text("connector_version").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("connector_registrations_source_unique").on(table.careerSourceId)],
);

export const sourcePolicyReviews = pgTable(
  "source_policy_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    careerSourceId: uuid("career_source_id").references(() => careerSources.id, {
      onDelete: "cascade",
    }),
    hostname: text("hostname").notNull(),
    status: policyStatus("status").default("pending_review").notNull(),
    robotsCheckedAt: timestamp("robots_checked_at", { withTimezone: true }),
    termsUrl: text("terms_url"),
    rationale: text("rationale").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("source_policy_reviews_user_hostname_unique").on(table.userId, table.hostname),
  ],
);
