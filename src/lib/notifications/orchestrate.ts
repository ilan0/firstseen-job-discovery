import "server-only";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import {
  canonicalJobs,
  companies,
  digestDeliveries,
  notifications,
  queueStates,
  recommendations,
  referrals,
  searchPreferences,
} from "@/db/schema";
import { freshness } from "@/domain/jobs";
import { rolloutFlags } from "@/config/rollout";
import { serverEnv } from "@/lib/env/server";
import { deliverPendingNotification } from "./slack";
import { digestPayload, exceptionalPayload, payloadHash, type DigestJob } from "./slack-payload";
import { hoursUntilQuietEnd, inQuietHours, zonedParts } from "./time";

export async function queueExceptionalAlert(options: {
  userId: string;
  jobId: string;
  snapshotId: string;
  title: string;
  company: string;
  headline: string;
  urgency: number;
  hasReferral: boolean;
  band: "hot" | "strong";
  officialUrl: string;
  freshnessAgeHours: number;
  freshnessBasis: "posted_at" | "reopened_at";
  primaryConcern: string;
  occurrenceId: string;
  now?: Date;
}) {
  const [prefs] = await db
    .select()
    .from(searchPreferences)
    .where(eq(searchPreferences.userId, options.userId))
    .limit(1);
  if (!prefs?.exceptionalAlertsEnabled) return null;
  if (!rolloutFlags().freshnessSlack && options.band !== "hot") return null;
  const now = options.now ?? new Date();
  if (options.freshnessAgeHours > 24) return null;
  const quiet = inQuietHours(
    zonedParts(now, prefs.timezone).hour,
    prefs.quietHoursStartLocal,
    prefs.quietHoursEndLocal,
  );
  const deferHours = hoursUntilQuietEnd(
    zonedParts(now, prefs.timezone).hour,
    prefs.quietHoursStartLocal,
    prefs.quietHoursEndLocal,
  );
  const payload = exceptionalPayload(options, serverEnv().NEXT_PUBLIC_APP_URL);
  const key = `exceptional:${options.jobId}:${options.occurrenceId}`;
  const [notification] = await db
    .insert(notifications)
    .values({
      userId: options.userId,
      jobId: options.jobId,
      snapshotId: options.snapshotId,
      kind: "exceptional_match",
      status: quiet ? "deferred" : "pending",
      idempotencyKey: key,
      payloadHash: payloadHash(payload),
      payload,
      deferredUntil: quiet ? new Date(now.getTime() + deferHours * 3_600_000) : now,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id, status: notifications.status });
  if (!notification || quiet) return notification ?? null;
  await deliverPendingNotification(notification.id, payload);
  return notification;
}

export async function deliverMorningDigest(userId: string, now = new Date()) {
  const [prefs] = await db
    .select()
    .from(searchPreferences)
    .where(eq(searchPreferences.userId, userId))
    .limit(1);
  if (!prefs?.digestEnabled) return { state: "disabled" as const };
  const local = zonedParts(now, prefs.timezone);
  if (local.hour !== prefs.digestHourLocal) return { state: "not_due" as const };
  const [existing] = await db
    .select({ id: digestDeliveries.id })
    .from(digestDeliveries)
    .where(
      and(eq(digestDeliveries.userId, userId), eq(digestDeliveries.localDate, local.localDate)),
    )
    .limit(1);
  if (existing) return { state: "already_delivered" as const };
  const [previousDigest] = await db
    .select({ deliveredAt: digestDeliveries.deliveredAt })
    .from(digestDeliveries)
    .where(and(eq(digestDeliveries.userId, userId), eq(digestDeliveries.status, "delivered")))
    .orderBy(desc(digestDeliveries.deliveredAt))
    .limit(1);
  const detectedAfter = previousDigest?.deliveredAt ?? new Date(now.getTime() - 7 * 24 * 3_600_000);
  const rows = await db
    .select({
      jobId: canonicalJobs.id,
      title: canonicalJobs.title,
      company: companies.name,
      companyId: companies.id,
      band: recommendations.band,
      urgency: recommendations.urgency,
      officialUrl: canonicalJobs.officialUrl,
      postedAt: canonicalJobs.postedAt,
      postedAtConfidence: canonicalJobs.postedAtConfidence,
      firstSeenAt: canonicalJobs.firstSeenAt,
      reopenedAt: canonicalJobs.reopenedAt,
      weaknesses: recommendations.weaknesses,
      routingReasons: recommendations.routingReasons,
    })
    .from(recommendations)
    .innerJoin(canonicalJobs, eq(recommendations.jobId, canonicalJobs.id))
    .innerJoin(companies, eq(canonicalJobs.companyId, companies.id))
    .innerJoin(
      queueStates,
      and(
        eq(queueStates.jobId, canonicalJobs.id),
        eq(queueStates.userId, userId),
        eq(queueStates.status, "active"),
      ),
    )
    .where(
      and(
        eq(recommendations.userId, userId),
        eq(recommendations.active, true),
        inArray(canonicalJobs.lifecycleStatus, ["open", "reopened"]),
        inArray(recommendations.band, ["hot", "strong", "possible", "review"]),
        gte(canonicalJobs.firstSeenAt, detectedAfter),
      ),
    )
    .orderBy(desc(recommendations.urgency))
    .limit(50);
  const referralRows = await db
    .select({ companyId: referrals.companyId })
    .from(referrals)
    .where(
      and(
        eq(referrals.userId, userId),
        inArray(referrals.status, ["available", "requested", "submitted"]),
      ),
    );
  const referred = new Set(referralRows.map((row) => row.companyId));
  const jobs = rows
    .flatMap((row): Array<DigestJob & { effectiveAt: Date }> => {
      const current = freshness(
        now,
        row.postedAt,
        row.postedAtConfidence,
        row.firstSeenAt,
        row.reopenedAt,
      );
      const weaknesses = Array.isArray(row.weaknesses)
        ? row.weaknesses.filter((item): item is string => typeof item === "string")
        : [];
      const routingReasons = Array.isArray(row.routingReasons)
        ? row.routingReasons.filter((item): item is string => typeof item === "string")
        : [];
      if (
        current.section !== "just_posted" &&
        current.section !== "new" &&
        current.section !== "recent"
      )
        return [];
      return [
        {
          title: row.title,
          company: row.company,
          band: row.band,
          urgency: row.urgency,
          jobId: row.jobId,
          officialUrl: row.officialUrl,
          hasReferral: referred.has(row.companyId),
          freshnessSection: current.section,
          freshnessAgeHours: current.ageHours,
          freshnessBasis: current.basis,
          detectionAgeHours: Math.max(0, (now.getTime() - row.firstSeenAt.getTime()) / 3_600_000),
          primaryConcern: weaknesses[0] ?? routingReasons[0] ?? "No material concern identified",
          effectiveAt: current.effectiveAt,
        },
      ];
    })
    .toSorted((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime());
  if (!jobs.length) return { state: "empty" as const };
  const payload = digestPayload(jobs, local.localDate, serverEnv().NEXT_PUBLIC_APP_URL);
  const key = `digest:${userId}:${local.localDate}`;
  const result = await db.transaction(async (tx) => {
    const [notification] = await tx
      .insert(notifications)
      .values({
        userId,
        kind: "morning_digest",
        status: "pending",
        idempotencyKey: key,
        payloadHash: payloadHash(payload),
        payload,
        deferredUntil: now,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (!notification) return null;
    const [digest] = await tx
      .insert(digestDeliveries)
      .values({
        userId,
        localDate: local.localDate,
        timezone: prefs.timezone,
        status: "pending",
        notificationId: notification.id,
        jobIds: jobs.map((job) => job.jobId),
      })
      .returning({ id: digestDeliveries.id });
    return digest ? { notificationId: notification.id, digestId: digest.id } : null;
  });
  if (!result) return { state: "already_delivered" as const };
  await deliverPendingNotification(result.notificationId, payload);
  await db
    .update(digestDeliveries)
    .set({ status: "delivered", deliveredAt: new Date(), updatedAt: new Date() })
    .where(eq(digestDeliveries.id, result.digestId));
  return { state: "delivered" as const, count: jobs.length };
}

export async function deliverDeferredAlerts(
  userId: string,
  now = new Date(),
  deliver: typeof deliverPendingNotification = deliverPendingNotification,
) {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.status, "deferred"),
        lte(notifications.deferredUntil, now),
      ),
    );
  let delivered = 0;
  for (const row of rows) {
    const [claimed] = await db
      .update(notifications)
      .set({ status: "pending", deferredUntil: now, updatedAt: now })
      .where(
        and(
          eq(notifications.id, row.id),
          eq(notifications.status, "deferred"),
          lte(notifications.deferredUntil, now),
        ),
      )
      .returning({ id: notifications.id });
    if (!claimed) continue;
    const result = await deliver(row.id);
    if (result.state === "delivered") delivered += 1;
  }
  return { delivered };
}
