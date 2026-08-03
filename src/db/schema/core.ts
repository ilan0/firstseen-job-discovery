import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const candidateProfiles = pgTable(
  "candidate_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    fullName: text("full_name").notNull(),
    headline: text("headline").notNull(),
    homeCity: text("home_city").notNull(),
    homeRegion: text("home_region").notNull(),
    monthsFullTimeExperience: integer("months_full_time_experience").notNull(),
    needsUsSponsorship: boolean("needs_us_sponsorship").default(false).notNull(),
    citizenships: text("citizenships")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    summary: text("summary").notNull(),
    education: jsonb("education").default({}).notNull(),
    workHistory: jsonb("work_history").default([]).notNull(),
    skills: jsonb("skills").default([]).notNull(),
    resumeSourceHash: text("resume_source_hash"),
    profileVersion: integer("profile_version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("candidate_profiles_user_id_unique").on(table.userId),
    check("candidate_profiles_months_nonnegative", sql`${table.monthsFullTimeExperience} >= 0`),
  ],
);

export const searchPreferences = pgTable(
  "search_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    fullTimeOnly: boolean("full_time_only").default(true).notNull(),
    idealRequiredYearsMax: integer("ideal_required_years_max").default(1).notNull(),
    eligibleRequiredYearsMax: integer("eligible_required_years_max").default(2).notNull(),
    rejectClearance: boolean("reject_clearance").default(true).notNull(),
    rejectPublicTrust: boolean("reject_public_trust").default(true).notNull(),
    acceptedAreas: jsonb("accepted_areas").default([]).notNull(),
    allowFullyRemote: boolean("allow_fully_remote").default(true).notNull(),
    rolePriorities: jsonb("role_priorities").default([]).notNull(),
    salaryMinimumUsd: integer("salary_minimum_usd"),
    industriesAllowed: text("industries_allowed").array(),
    timezone: text("timezone").default("America/New_York").notNull(),
    digestEnabled: boolean("digest_enabled").default(true).notNull(),
    exceptionalAlertsEnabled: boolean("exceptional_alerts_enabled").default(true).notNull(),
    digestHourLocal: integer("digest_hour_local").default(8).notNull(),
    quietHoursStartLocal: integer("quiet_hours_start_local").default(22).notNull(),
    quietHoursEndLocal: integer("quiet_hours_end_local").default(7).notNull(),
    broadDiscoveryCadenceMinutes: integer("broad_discovery_cadence_minutes").default(240).notNull(),
    preferencesVersion: integer("preferences_version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("search_preferences_user_id_unique").on(table.userId),
    check(
      "search_preferences_experience_bounds",
      sql`${table.idealRequiredYearsMax} <= ${table.eligibleRequiredYearsMax}`,
    ),
    check("search_preferences_digest_hour", sql`${table.digestHourLocal} between 0 and 23`),
  ],
);
