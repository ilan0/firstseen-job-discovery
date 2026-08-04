import {
  boolean,
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
import { connectorKind } from "./enums";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const providerCapabilities = pgTable(
  "provider_capabilities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    connectorKind: connectorKind("connector_kind"),
    capabilityVersion: text("capability_version").notNull(),
    anonymousAccess: boolean("anonymous_access").default(false).notNull(),
    documentedApi: boolean("documented_api").default(false).notNull(),
    supportsPagination: boolean("supports_pagination").default(false).notNull(),
    supportsConditionalRequests: boolean("supports_conditional_requests").default(false).notNull(),
    supportsPublishedTime: boolean("supports_published_time").default(false).notNull(),
    supportsClosure: boolean("supports_closure").default(false).notNull(),
    operationalLimits: jsonb("operational_limits").default({}).notNull(),
    evidenceUrls: text("evidence_urls").array().notNull(),
    active: boolean("active").default(false).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("provider_capabilities_provider_version_unique").on(
      table.provider,
      table.capabilityVersion,
    ),
  ],
);

export const providerLicenseRecords = pgTable(
  "provider_license_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    licenseVersion: text("license_version").notNull(),
    status: text("status").notNull(),
    personalUse: boolean("personal_use").default(false).notNull(),
    commercialUse: boolean("commercial_use").default(false).notNull(),
    mayPersist: boolean("may_persist").default(false).notNull(),
    mayDisplay: boolean("may_display").default(false).notNull(),
    mayResolveRedirects: boolean("may_resolve_redirects").default(false).notNull(),
    retentionDays: integer("retention_days"),
    termsUrl: text("terms_url"),
    evidence: jsonb("evidence").default({}).notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    terminatedAt: timestamp("terminated_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("provider_license_records_provider_version_unique").on(
      table.provider,
      table.licenseVersion,
    ),
  ],
);

export const coverageBenchmarks = pgTable(
  "coverage_benchmarks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cohort: text("cohort").notNull(),
    sourceFamily: text("source_family").notNull(),
    expectedOfficialUrlHash: text("expected_official_url_hash").notNull(),
    expectedOfficialUrlEncrypted: text("expected_official_url_encrypted"),
    independentObservedAt: timestamp("independent_observed_at", { withTimezone: true }).notNull(),
    firstseenDetectedAt: timestamp("firstseen_detected_at", { withTimezone: true }),
    eligibilityLabel: text("eligibility_label").notNull(),
    matched: boolean("matched").default(false).notNull(),
    detectionLatencyMinutes: numeric("detection_latency_minutes", { precision: 12, scale: 3 }),
    benchmarkVersion: text("benchmark_version").notNull(),
    labelEvidence: jsonb("label_evidence").default({}).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("coverage_benchmarks_url_version_unique").on(
      table.expectedOfficialUrlHash,
      table.benchmarkVersion,
    ),
    index("coverage_benchmarks_cohort_family_idx").on(table.cohort, table.sourceFamily),
  ],
);
