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
import { contactMethodKind, referralStatus } from "./enums";
import { globalJobs, organizations } from "./global-supply";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    title: text("title"),
    team: text("team"),
    location: text("location"),
    relationshipOrigin: text("relationship_origin"),
    relationshipStrength: integer("relationship_strength").default(3).notNull(),
    notes: text("notes"),
    active: boolean("active").default(true).notNull(),
    legacyReferralId: uuid("legacy_referral_id"),
    ...timestamps,
  },
  (table) => [
    index("contacts_user_name_idx").on(table.userId, table.name),
    uniqueIndex("contacts_legacy_referral_unique").on(table.legacyReferralId),
    check(
      "contacts_relationship_strength_range",
      sql`${table.relationshipStrength} between 1 and 5`,
    ),
  ],
);

export const contactMethods = pgTable(
  "contact_methods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: contactMethodKind("kind").notNull(),
    value: text("value").notNull(),
    label: text("label"),
    primary: boolean("primary").default(false).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("contact_methods_contact_kind_value_unique").on(
      table.contactId,
      table.kind,
      table.value,
    ),
  ],
);

export const contactCompanyLinks = pgTable(
  "contact_company_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    relationshipStatus: text("relationship_status").default("current").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("contact_company_links_contact_org_unique").on(
      table.contactId,
      table.organizationId,
    ),
    index("contact_company_links_user_org_idx").on(table.userId, table.organizationId),
  ],
);

export const contactInteractions = pgTable(
  "contact_interactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    interactionType: text("interaction_type").notNull(),
    summary: text("summary").notNull(),
    outcome: text("outcome"),
    metadata: jsonb("metadata").default({}).notNull(),
    ...timestamps,
  },
  (table) => [index("contact_interactions_contact_time_idx").on(table.contactId, table.occurredAt)],
);

export const relationshipReminders = pgTable(
  "relationship_reminders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    nextAction: text("next_action").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("relationship_reminders_user_due_idx").on(table.userId, table.dueAt)],
);

export const referralRequests = pgTable(
  "referral_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => globalJobs.id, { onDelete: "set null" }),
    status: referralStatus("status").default("available").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    notes: text("notes"),
    inferred: boolean("inferred").default(false).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("referral_requests_user_contact_org_job_unique").on(
      table.userId,
      table.contactId,
      table.organizationId,
      table.jobId,
    ),
    index("referral_requests_user_org_status_idx").on(
      table.userId,
      table.organizationId,
      table.status,
    ),
  ],
);
