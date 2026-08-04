import "server-only";
import { and, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  canonicalJobs,
  applicationSessions,
  careerSources,
  companies,
  contactCompanyLinks,
  contactInteractions,
  contactMethods,
  contacts,
  eligibilityDecisions,
  jobDescriptionSnapshots,
  queueStates,
  rankingDimensions,
  recommendations,
  referrals,
  referralRequests,
} from "@/db/schema";
import {
  freshness,
  parseFeedSort,
  parsePostedWindow,
  withinPostedWindow,
  type FeedSort,
  type PostedWindow,
} from "@/domain/jobs";
import { ELIGIBILITY_RULE_VERSION } from "@/domain/eligibility";
import { RANKING_VERSION } from "@/domain/ranking";
import { recommendContact } from "@/domain/relationships/best-contact";

export type QueueStatus = "active" | "saved" | "applied" | "dismissed";
export type FeedQuery = {
  postedWithin?: PostedWindow;
  sort?: FeedSort;
  query?: string;
  band?: "all" | "hot" | "strong" | "possible" | "review";
  referralsOnly?: boolean;
  cursor?: string;
};

type QueueCursor = {
  sort: FeedSort;
  effectiveAt: string;
  detectedAt: string;
  urgency: number;
  id: string;
};

function parseCursor(value: string | undefined, sort: FeedSort): QueueCursor | null {
  if (!value || value.length > 800) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<QueueCursor>;
    if (
      parsed.sort !== sort ||
      typeof parsed.effectiveAt !== "string" ||
      typeof parsed.detectedAt !== "string" ||
      typeof parsed.urgency !== "number" ||
      typeof parsed.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(parsed.id) ||
      !Number.isFinite(Date.parse(parsed.effectiveAt)) ||
      !Number.isFinite(Date.parse(parsed.detectedAt))
    )
      return null;
    return parsed as QueueCursor;
  } catch {
    return null;
  }
}

function encodeCursor(cursor: QueueCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export async function listQueuePage(userId: string, status: QueueStatus, input: FeedQuery = {}) {
  const postedWithin = parsePostedWindow(input.postedWithin, "all");
  const sort = parseFeedSort(input.sort, status === "active" ? "posted_newest" : "urgency");
  const now = new Date();
  const trustworthyFutureBoundary = new Date(now.getTime() + 5 * 60_000);
  const trustworthyFutureBoundaryIso = trustworthyFutureBoundary.toISOString();
  const effectivePostedAt = sql<Date>`case
    when ${canonicalJobs.reopenedAt} is not null
      and ${canonicalJobs.reopenedAt} <= ${trustworthyFutureBoundaryIso}::timestamptz
      then ${canonicalJobs.reopenedAt}
    when ${canonicalJobs.postedAt} is not null
      and ${canonicalJobs.postedAtConfidence} <> 'low'
      and ${canonicalJobs.postedAt} <= ${trustworthyFutureBoundaryIso}::timestamptz
      then ${canonicalJobs.postedAt}
    else ${canonicalJobs.firstSeenAt}
  end`;
  const effectiveUrgency = sql<number>`coalesce(${recommendations.urgency}, -1)`;
  const cutoff =
    postedWithin === "all"
      ? null
      : new Date(
          now.getTime() -
            ({ "6h": 6, "24h": 24, "3d": 72, "7d": 168, "30d": 720 } as const)[postedWithin] *
              3_600_000,
        );
  const search = input.query?.trim();
  const cursor = status === "active" ? parseCursor(input.cursor, sort) : null;
  const cursorFilter = cursor
    ? sort === "detected_newest"
      ? sql`(${canonicalJobs.firstSeenAt}, ${canonicalJobs.id}) <
          (${cursor.detectedAt}::timestamptz, ${cursor.id}::uuid)`
      : sort === "urgency"
        ? sql`(${effectiveUrgency}, ${effectivePostedAt}, ${canonicalJobs.id}) <
            (${cursor.urgency}, ${cursor.effectiveAt}::timestamptz, ${cursor.id}::uuid)`
        : sql`(${effectivePostedAt}, ${canonicalJobs.id}) <
            (${cursor.effectiveAt}::timestamptz, ${cursor.id}::uuid)`
    : null;
  const activeFilters =
    status === "active"
      ? [
          inArray(canonicalJobs.lifecycleStatus, ["open", "reopened"]),
          inArray(recommendations.band, ["hot", "strong", "possible", "review"]),
          eq(eligibilityDecisions.ruleVersion, ELIGIBILITY_RULE_VERSION),
          eq(recommendations.rankingVersion, RANKING_VERSION),
          ...(cutoff ? [sql`${effectivePostedAt} >= ${cutoff.toISOString()}::timestamptz`] : []),
          ...(search
            ? [or(ilike(canonicalJobs.title, `%${search}%`), ilike(companies.name, `%${search}%`))!]
            : []),
          ...(input.band && input.band !== "all" ? [eq(recommendations.band, input.band)] : []),
          ...(input.referralsOnly
            ? [
                sql`exists (
                  select 1 from referrals referral_filter
                  where referral_filter.user_id = ${userId}
                    and referral_filter.company_id = ${canonicalJobs.companyId}
                    and referral_filter.status in ('available', 'requested', 'submitted')
                )`,
              ]
            : []),
          ...(cursorFilter ? [cursorFilter] : []),
        ]
      : [];
  const ordering =
    sort === "detected_newest"
      ? [desc(canonicalJobs.firstSeenAt), desc(canonicalJobs.id)]
      : sort === "urgency"
        ? [desc(recommendations.urgency), desc(effectivePostedAt), desc(canonicalJobs.id)]
        : [desc(effectivePostedAt), desc(canonicalJobs.id)];
  const rows = await db
    .select({
      jobId: canonicalJobs.id,
      companyId: canonicalJobs.companyId,
      title: canonicalJobs.title,
      company: companies.name,
      officialUrl: canonicalJobs.officialUrl,
      lifecycleStatus: canonicalJobs.lifecycleStatus,
      postedAt: canonicalJobs.postedAt,
      postedAtConfidence: canonicalJobs.postedAtConfidence,
      firstSeenAt: canonicalJobs.firstSeenAt,
      reopenedAt: canonicalJobs.reopenedAt,
      verifiedAt: canonicalJobs.verifiedAt,
      band: recommendations.band,
      urgency: recommendations.urgency,
      headline: recommendations.headline,
      strengths: recommendations.strengths,
      weaknesses: recommendations.weaknesses,
      routingReasons: recommendations.routingReasons,
      eligibilityFacts: eligibilityDecisions.normalizedFacts,
      snapshotFacts: jobDescriptionSnapshots.normalizedFacts,
      snapshotCapturedAt: jobDescriptionSnapshots.capturedAt,
      materialChangeReasons: jobDescriptionSnapshots.materialChangeReasons,
      eligibilityRuleVersion: eligibilityDecisions.ruleVersion,
      rankingVersion: recommendations.rankingVersion,
      sourceKind: careerSources.connectorKind,
      sourceConfidence: careerSources.parsingConfidence,
      queueStatus: queueStates.status,
      rowVersion: queueStates.rowVersion,
      effectiveSortAt: effectivePostedAt,
    })
    .from(queueStates)
    .innerJoin(canonicalJobs, eq(queueStates.jobId, canonicalJobs.id))
    .innerJoin(companies, eq(canonicalJobs.companyId, companies.id))
    .innerJoin(careerSources, eq(canonicalJobs.authoritativeSourceId, careerSources.id))
    .leftJoin(
      recommendations,
      and(eq(recommendations.jobId, canonicalJobs.id), eq(recommendations.active, true)),
    )
    .leftJoin(
      eligibilityDecisions,
      eq(recommendations.eligibilityDecisionId, eligibilityDecisions.id),
    )
    .leftJoin(jobDescriptionSnapshots, eq(recommendations.snapshotId, jobDescriptionSnapshots.id))
    .where(and(eq(queueStates.userId, userId), eq(queueStates.status, status), ...activeFilters))
    .orderBy(...ordering)
    .limit(status === "active" ? 61 : 101);

  if (!rows.length) return { items: [], nextCursor: null };
  const pageSize = status === "active" ? 60 : 100;
  const pageRows = rows.slice(0, pageSize);
  const referralRows = await db
    .select({ companyId: referrals.companyId })
    .from(referrals)
    .where(
      and(
        eq(referrals.userId, userId),
        inArray(referrals.status, ["available", "requested", "submitted"]),
      ),
    );
  const referredCompanies = new Set(referralRows.map((row) => row.companyId));
  const items = pageRows
    .map((row) => {
      const currentFreshness = freshness(
        now,
        row.postedAt,
        row.postedAtConfidence,
        row.firstSeenAt,
        row.reopenedAt,
      );
      const eligibilityFacts = row.eligibilityFacts as {
        locations?: { value?: unknown };
        workArrangement?: { value?: unknown };
      } | null;
      const snapshotFacts = row.snapshotFacts as { salary?: unknown } | null;
      const locations = Array.isArray(eligibilityFacts?.locations?.value)
        ? eligibilityFacts.locations.value.filter(
            (location): location is string => typeof location === "string" && Boolean(location),
          )
        : [];
      return {
        ...row,
        eligibilityFacts: undefined,
        snapshotFacts: undefined,
        urgency: row.urgency === null ? null : Math.min(row.urgency, currentFreshness.value),
        freshnessBand: currentFreshness.band,
        freshnessBasis: currentFreshness.basis,
        freshnessAgeHours: currentFreshness.ageHours,
        freshnessSection: currentFreshness.section,
        freshnessEffectiveAt: currentFreshness.effectiveAt,
        updated: (row.materialChangeReasons?.length ?? 0) > 0,
        location: locations.join(" · ") || "Location not provided",
        workArrangement:
          typeof eligibilityFacts?.workArrangement?.value === "string"
            ? eligibilityFacts.workArrangement.value
            : "unknown",
        salary: typeof snapshotFacts?.salary === "string" ? snapshotFacts.salary : null,
        hasReferral: referredCompanies.has(row.companyId),
      };
    })
    .filter((row) => {
      if (status !== "active") return true;
      const query = input.query?.trim().toLowerCase() ?? "";
      return (
        withinPostedWindow(row.freshnessAgeHours, postedWithin) &&
        (!query || `${row.title} ${row.company}`.toLowerCase().includes(query)) &&
        (!input.band || input.band === "all" || row.band === input.band) &&
        (!input.referralsOnly || row.hasReferral)
      );
    })
    .toSorted((a, b) => {
      if (sort === "detected_newest")
        return b.firstSeenAt.getTime() - a.firstSeenAt.getTime() || b.jobId.localeCompare(a.jobId);
      if (sort === "urgency")
        return (
          (b.urgency ?? -1) - (a.urgency ?? -1) ||
          b.freshnessEffectiveAt.getTime() - a.freshnessEffectiveAt.getTime() ||
          b.jobId.localeCompare(a.jobId)
        );
      return (
        b.freshnessEffectiveAt.getTime() - a.freshnessEffectiveAt.getTime() ||
        b.jobId.localeCompare(a.jobId)
      );
    });
  const last = pageRows.at(-1);
  return {
    items,
    nextCursor:
      rows.length > pageSize && last
        ? encodeCursor({
            sort,
            effectiveAt: new Date(last.effectiveSortAt).toISOString(),
            detectedAt: last.firstSeenAt.toISOString(),
            urgency: last.urgency ?? -1,
            id: last.jobId,
          })
        : null,
  };
}

export async function listQueue(userId: string, status: QueueStatus, input: FeedQuery = {}) {
  return (await listQueuePage(userId, status, input)).items;
}

export async function getJobDetail(userId: string, jobId: string) {
  const [job] = await db
    .select({
      id: canonicalJobs.id,
      companyId: companies.id,
      companyOrganizationId: companies.organizationId,
      globalJobId: canonicalJobs.globalJobId,
      title: canonicalJobs.title,
      company: companies.name,
      officialUrl: canonicalJobs.officialUrl,
      lifecycleStatus: canonicalJobs.lifecycleStatus,
      employmentType: canonicalJobs.employmentType,
      postedAt: canonicalJobs.postedAt,
      postedAtConfidence: canonicalJobs.postedAtConfidence,
      firstSeenAt: canonicalJobs.firstSeenAt,
      reopenedAt: canonicalJobs.reopenedAt,
      lastSeenAt: canonicalJobs.lastSeenAt,
      verifiedAt: canonicalJobs.verifiedAt,
      sourceKind: careerSources.connectorKind,
      sourceConfidence: careerSources.parsingConfidence,
      band: recommendations.band,
      urgency: recommendations.urgency,
      headline: recommendations.headline,
      strengths: recommendations.strengths,
      weaknesses: recommendations.weaknesses,
      routingReasons: recommendations.routingReasons,
      status: queueStates.status,
      rowVersion: queueStates.rowVersion,
      eligibilityOutcome: eligibilityDecisions.outcome,
      eligibilityReasons: eligibilityDecisions.reasons,
      uncertainFields: eligibilityDecisions.uncertainFields,
      eligibilityFacts: eligibilityDecisions.normalizedFacts,
      descriptionText: jobDescriptionSnapshots.descriptionText,
      snapshotCapturedAt: jobDescriptionSnapshots.capturedAt,
      materialChangeReasons: jobDescriptionSnapshots.materialChangeReasons,
      recommendationSnapshotId: recommendations.snapshotId,
      rankingVersion: recommendations.rankingVersion,
    })
    .from(canonicalJobs)
    .innerJoin(companies, eq(canonicalJobs.companyId, companies.id))
    .innerJoin(careerSources, eq(canonicalJobs.authoritativeSourceId, careerSources.id))
    .leftJoin(
      queueStates,
      and(eq(queueStates.jobId, canonicalJobs.id), eq(queueStates.userId, userId)),
    )
    .leftJoin(
      recommendations,
      and(eq(recommendations.jobId, canonicalJobs.id), eq(recommendations.active, true)),
    )
    .leftJoin(
      eligibilityDecisions,
      eq(recommendations.eligibilityDecisionId, eligibilityDecisions.id),
    )
    .leftJoin(jobDescriptionSnapshots, eq(recommendations.snapshotId, jobDescriptionSnapshots.id))
    .where(and(eq(canonicalJobs.userId, userId), eq(canonicalJobs.id, jobId)))
    .limit(1);
  if (!job) return null;
  const dimensions = await db
    .select()
    .from(rankingDimensions)
    .where(
      and(
        eq(rankingDimensions.userId, userId),
        eq(rankingDimensions.jobId, jobId),
        ...(job.recommendationSnapshotId
          ? [eq(rankingDimensions.snapshotId, job.recommendationSnapshotId)]
          : []),
        ...(job.rankingVersion ? [eq(rankingDimensions.rankingVersion, job.rankingVersion)] : []),
      ),
    )
    .orderBy(rankingDimensions.dimension);
  const referralRows = await db
    .select()
    .from(referrals)
    .where(and(eq(referrals.userId, userId), eq(referrals.companyId, job.companyId)));
  const contactRows = job.companyOrganizationId
    ? await db
        .select({
          id: contacts.id,
          name: contacts.name,
          title: contacts.title,
          team: contacts.team,
          relationshipStrength: contacts.relationshipStrength,
          relationshipStatus: contactCompanyLinks.relationshipStatus,
        })
        .from(contactCompanyLinks)
        .innerJoin(contacts, eq(contactCompanyLinks.contactId, contacts.id))
        .where(
          and(
            eq(contactCompanyLinks.userId, userId),
            eq(contactCompanyLinks.organizationId, job.companyOrganizationId),
            eq(contacts.active, true),
          ),
        )
    : [];
  const contactIds = contactRows.map((contact) => contact.id);
  const [interactions, requestRows, methodRows] = contactIds.length
    ? await Promise.all([
        db
          .select({
            contactId: contactInteractions.contactId,
            occurredAt: sql<Date>`max(${contactInteractions.occurredAt})`.mapWith(
              contactInteractions.occurredAt,
            ),
          })
          .from(contactInteractions)
          .where(
            and(
              eq(contactInteractions.userId, userId),
              inArray(contactInteractions.contactId, contactIds),
            ),
          )
          .groupBy(contactInteractions.contactId),
        job.companyOrganizationId
          ? db
              .select({
                contactId: referralRequests.contactId,
                status: referralRequests.status,
              })
              .from(referralRequests)
              .where(
                and(
                  eq(referralRequests.userId, userId),
                  eq(referralRequests.organizationId, job.companyOrganizationId),
                  inArray(referralRequests.contactId, contactIds),
                ),
              )
              .orderBy(desc(referralRequests.updatedAt))
          : Promise.resolve([]),
        db
          .select({
            contactId: contactMethods.contactId,
            kind: contactMethods.kind,
            value: contactMethods.value,
            primary: contactMethods.primary,
          })
          .from(contactMethods)
          .where(
            and(eq(contactMethods.userId, userId), inArray(contactMethods.contactId, contactIds)),
          )
          .orderBy(desc(contactMethods.primary)),
      ])
    : [[], [], []];
  const interactionByContact = new Map(
    interactions.map((interaction) => [interaction.contactId, interaction.occurredAt]),
  );
  const referralByContact = new Map<string, string>();
  for (const request of requestRows)
    if (!referralByContact.has(request.contactId))
      referralByContact.set(request.contactId, request.status);
  const recommended = recommendContact(
    contactRows.map((contact) => ({
      ...contact,
      lastInteractionAt: interactionByContact.get(contact.id) ?? null,
      referralStatus: referralByContact.get(contact.id) ?? null,
    })),
    job.title,
  );
  const recommendedContact = recommended
    ? {
        ...recommended,
        methods: methodRows.filter((method) => method.contactId === recommended.id),
      }
    : null;
  const [pendingApplicationSession] = await db
    .select({
      id: applicationSessions.id,
      openedAt: applicationSessions.openedAt,
      disposition: applicationSessions.disposition,
    })
    .from(applicationSessions)
    .where(
      and(
        eq(applicationSessions.userId, userId),
        eq(applicationSessions.legacyJobId, jobId),
        inArray(applicationSessions.disposition, ["opened", "continue_later"]),
        gt(applicationSessions.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(applicationSessions.openedAt))
    .limit(1);
  const currentFreshness = freshness(
    new Date(),
    job.postedAt,
    job.postedAtConfidence,
    job.firstSeenAt,
    job.reopenedAt,
  );
  return {
    ...job,
    freshness: currentFreshness,
    dimensions,
    referrals: referralRows,
    recommendedContact,
    pendingApplicationSession: pendingApplicationSession ?? null,
  };
}
