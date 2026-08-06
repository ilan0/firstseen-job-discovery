import "server-only";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  canonicalJobs,
  companies,
  digestDeliveries,
  notificationChannels,
  notificationDeliveries,
  notificationReads,
  notifications,
  outboxEvents,
  pushSubscriptions,
  queueStates,
  recommendations,
  referralRequests,
  referrals,
  searchPreferences,
} from "@/db/schema";
import { freshness } from "@/domain/jobs";
import type { RoleFamily } from "@/domain/eligibility/types";
import { evaluateNotificationPolicy, PUSH_POLICY_VERSION } from "@/domain/notifications/policy";
import { rolloutFlags } from "@/config/rollout";
import { inngest } from "@/inngest/client";
import { serverEnv } from "@/lib/env/server";
import { deliverPendingNotification } from "./slack";
import { digestPayload, exceptionalPayload, payloadHash, type DigestJob } from "./slack-payload";
import { hoursUntilQuietEnd, inQuietHours, zonedParts } from "./time";
import { deliverDueWebPush, queueWebPushDeliveries } from "./web-push";
import { loadEffectivePushPolicy } from "./preferences";

export type JobAlertCandidate = {
  userId: string;
  jobId: string;
  snapshotId: string;
  title: string;
  company: string;
  headline: string;
  urgency: number;
  hasReferral: boolean;
  interestedCompany?: boolean;
  band: "hot" | "strong" | "possible" | "review" | "not_recommended";
  roleFamily: RoleFamily;
  eligibilityOutcome: "eligible" | "ineligible" | "review";
  uncertainFields: string[];
  officialUrl: string;
  freshnessAgeHours: number;
  freshnessBasis: "posted_at" | "reopened_at" | "first_seen";
  primaryConcern: string;
  occurrenceId: string;
  now?: Date;
};

export async function queueJobAlert(options: JobAlertCandidate) {
  const now = options.now ?? new Date();
  const [job] = await db
    .select({
      globalJobId: canonicalJobs.globalJobId,
      companyId: canonicalJobs.companyId,
      organizationId: companies.organizationId,
      interested: companies.interested,
      lifecycleStatus: canonicalJobs.lifecycleStatus,
      queueStatus: queueStates.status,
    })
    .from(canonicalJobs)
    .innerJoin(companies, eq(canonicalJobs.companyId, companies.id))
    .leftJoin(
      queueStates,
      and(eq(queueStates.userId, options.userId), eq(queueStates.jobId, canonicalJobs.id)),
    )
    .where(and(eq(canonicalJobs.userId, options.userId), eq(canonicalJobs.id, options.jobId)))
    .limit(1);
  if (!job?.organizationId) return null;
  const [{ policy, companyOverrideMode }, referralRows] = await Promise.all([
    loadEffectivePushPolicy(options.userId, job.organizationId),
    db
      .select({ id: referralRequests.id })
      .from(referralRequests)
      .where(
        and(
          eq(referralRequests.userId, options.userId),
          eq(referralRequests.organizationId, job.organizationId),
          inArray(referralRequests.status, ["available", "requested", "agreed", "submitted"]),
        ),
      )
      .limit(1),
  ]);
  const key = `job-alert:${options.jobId}:${options.occurrenceId}`;
  const [prior] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, options.userId), eq(notifications.idempotencyKey, key)))
    .limit(1);
  if (prior) return null;
  const decision = evaluateNotificationPolicy(
    {
      officiallyVerified: true,
      lifecycleStatus: job.lifecycleStatus,
      eligibilityOutcome: options.eligibilityOutcome,
      uncertainFields: options.uncertainFields,
      queueStatus: job.queueStatus ?? "active",
      band: options.band,
      roleFamily: options.roleFamily,
      freshnessAgeHours: options.freshnessAgeHours,
      freshnessBasis: options.freshnessBasis,
      timestampReliable: options.freshnessBasis !== "first_seen",
      hasActiveReferral: options.hasReferral || referralRows.length > 0,
      interestedCompany: options.interestedCompany ?? job.interested,
      companyOverrideMode,
      alreadyAlerted: false,
    },
    policy,
    now,
  );
  const payload = {
    path: `/jobs/${options.jobId}`,
    title: options.title,
    company: options.company,
    band: options.band,
    urgency: options.urgency,
    reason: decision.reason,
    primaryConcern: options.primaryConcern,
    policyFacts: {
      roleFamily: options.roleFamily,
      eligibilityOutcome: options.eligibilityOutcome,
      uncertainFields: options.uncertainFields,
    },
  };
  if (!decision.eligible) {
    await db.transaction((tx) =>
      tx
        .insert(notifications)
        .values({
          userId: options.userId,
          jobId: options.jobId,
          snapshotId: options.snapshotId,
          kind: "job_alert",
          status: "suppressed",
          idempotencyKey: key,
          payloadHash: payloadHash(payload),
          payload,
          occurrenceId: options.occurrenceId,
          reasonCodes: [decision.reason],
          policyVersion: PUSH_POLICY_VERSION,
        })
        .onConflictDoNothing(),
    );
    return null;
  }
  const queued = await db.transaction(async (tx) => {
    const subscriptions = await tx
      .select({
        id: pushSubscriptions.id,
        channelId: pushSubscriptions.channelId,
        detailed: pushSubscriptions.detailedLockScreen,
      })
      .from(pushSubscriptions)
      .innerJoin(notificationChannels, eq(pushSubscriptions.channelId, notificationChannels.id))
      .where(
        and(
          eq(pushSubscriptions.userId, options.userId),
          eq(notificationChannels.enabled, true),
          isNull(pushSubscriptions.revokedAt),
          or(isNull(pushSubscriptions.expirationTime), gte(pushSubscriptions.expirationTime, now)),
        ),
      );
    const [notification] = await tx
      .insert(notifications)
      .values({
        userId: options.userId,
        jobId: options.jobId,
        snapshotId: options.snapshotId,
        kind: "job_alert",
        status: subscriptions.length
          ? decision.notBefore > now
            ? "deferred"
            : "pending"
          : "suppressed",
        idempotencyKey: key,
        payloadHash: payloadHash(payload),
        payload,
        occurrenceId: options.occurrenceId,
        reasonCodes: subscriptions.length
          ? [decision.reason]
          : [decision.reason, "no_active_device"],
        policyVersion: PUSH_POLICY_VERSION,
        deferredUntil: subscriptions.length ? decision.notBefore : null,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (!notification || !subscriptions.length)
      return {
        notification: notification ?? null,
        outbox: [] as { id: string; deliveryId: string }[],
      };
    const recentAlertCounts = await tx
      .select({
        subscriptionId: notificationDeliveries.pushSubscriptionId,
        count: sql<number>`count(*)`,
      })
      .from(notificationDeliveries)
      .innerJoin(notifications, eq(notificationDeliveries.logicalNotificationId, notifications.id))
      .where(
        and(
          eq(notificationDeliveries.userId, options.userId),
          inArray(
            notificationDeliveries.pushSubscriptionId,
            subscriptions.map((subscription) => subscription.id),
          ),
          eq(notifications.kind, "job_alert"),
          gte(notificationDeliveries.createdAt, new Date(now.getTime() - 3_600_000)),
          inArray(notificationDeliveries.status, ["pending", "sending", "delivered", "deferred"]),
        ),
      )
      .groupBy(notificationDeliveries.pushSubscriptionId);
    const recentBySubscription = new Map(
      recentAlertCounts.flatMap((row) =>
        row.subscriptionId ? [[row.subscriptionId, Number(row.count)] as const] : [],
      ),
    );
    const [unread] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, options.userId),
          sql`not exists (
            select 1 from ${notificationReads}
            where ${notificationReads.userId} = ${options.userId}
              and ${notificationReads.logicalNotificationId} = ${notifications.id}
          )`,
        ),
      );
    const outbox: { id: string; deliveryId: string }[] = [];
    for (const subscription of subscriptions) {
      const overflow = (recentBySubscription.get(subscription.id) ?? 0) >= 6;
      const deliveryPayload = overflow
        ? {
            title: "More fresh FirstSeen matches",
            body: "Several verified jobs are ready to review.",
            path: "/",
            tag: "firstseen-fresh-overflow",
            notificationId: notification.id,
            unreadCount: Number(unread?.count ?? 0),
          }
        : subscription.detailed
          ? {
              title: `${options.band[0]?.toUpperCase()}${options.band.slice(1)} match · ${options.company}`,
              body: options.title,
              path: `/jobs/${options.jobId}`,
              tag: `firstseen-job-${options.jobId}-${options.occurrenceId}`,
              notificationId: notification.id,
              unreadCount: Number(unread?.count ?? 0),
            }
          : {
              title: "New FirstSeen match",
              body: `Urgency ${options.urgency} · Open FirstSeen to review it.`,
              path: `/jobs/${options.jobId}`,
              tag: `firstseen-job-${options.jobId}-${options.occurrenceId}`,
              notificationId: notification.id,
              unreadCount: Number(unread?.count ?? 0),
            };
      const [delivery] = await tx
        .insert(notificationDeliveries)
        .values({
          userId: options.userId,
          logicalNotificationId: notification.id,
          globalJobId: job.globalJobId,
          channelId: subscription.channelId,
          pushSubscriptionId: subscription.id,
          reason: overflow ? `${decision.reason}:overflow` : decision.reason,
          policyVersion: PUSH_POLICY_VERSION,
          idempotencyKey: `push:${notification.id}:${subscription.id}`,
          status: decision.notBefore > now ? "deferred" : "pending",
          nextAttemptAt: decision.notBefore,
          providerResponseSafe: { payload: deliveryPayload },
        })
        .onConflictDoNothing()
        .returning({ id: notificationDeliveries.id });
      if (!delivery) continue;
      const [event] = await tx
        .insert(outboxEvents)
        .values({
          userId: options.userId,
          eventName: "firstseen/push.delivery.requested",
          aggregateType: "notification_delivery",
          aggregateId: delivery.id,
          idempotencyKey: `push-delivery-outbox:${delivery.id}`,
          payload: { userId: options.userId, deliveryId: delivery.id },
          availableAt: decision.notBefore,
        })
        .onConflictDoNothing()
        .returning({ id: outboxEvents.id });
      if (event) outbox.push({ id: event.id, deliveryId: delivery.id });
    }
    return { notification, outbox };
  });
  if (!queued.notification) return null;
  if (decision.notBefore <= now && queued.outbox.length) {
    try {
      await inngest.send(
        queued.outbox.map((event) => ({
          id: event.id,
          name: "firstseen/push.delivery.requested" as const,
          data: { userId: options.userId, deliveryId: event.deliveryId },
        })),
      );
      await db
        .update(outboxEvents)
        .set({ status: "dispatched", dispatchedAt: now, updatedAt: now })
        .where(
          inArray(
            outboxEvents.id,
            queued.outbox.map((event) => event.id),
          ),
        );
    } catch {
      // Delivery rows are durable; the recovery scheduler will claim them.
    }
  }
  return queued.notification;
}

export async function queueRecommendationAlert(options: JobAlertCandidate) {
  if (rolloutFlags().pushPolicyV2) return queueJobAlert(options);
  if (
    (options.band !== "hot" && options.band !== "strong") ||
    options.urgency < 85 ||
    options.freshnessBasis === "first_seen" ||
    options.eligibilityOutcome !== "eligible" ||
    options.uncertainFields.length
  )
    return null;
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
  const payload = exceptionalPayload(
    {
      title: options.title,
      company: options.company,
      headline: options.headline,
      urgency: options.urgency,
      jobId: options.jobId,
      hasReferral: options.hasReferral,
      band: options.band as "hot" | "strong",
      officialUrl: options.officialUrl,
      freshnessAgeHours: options.freshnessAgeHours,
      freshnessBasis: options.freshnessBasis as "posted_at" | "reopened_at",
      primaryConcern: options.primaryConcern,
    },
    serverEnv().NEXT_PUBLIC_APP_URL,
  );
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
  if (!notification) return null;
  if (rolloutFlags().webPush) {
    const [job] = await db
      .select({ globalJobId: canonicalJobs.globalJobId })
      .from(canonicalJobs)
      .where(and(eq(canonicalJobs.userId, options.userId), eq(canonicalJobs.id, options.jobId)))
      .limit(1);
    await queueWebPushDeliveries({
      userId: options.userId,
      logicalNotificationId: notification.id,
      globalJobId: job?.globalJobId ?? null,
      reason: "fresh_exceptional_match",
      message: {
        path: `/jobs/${options.jobId}`,
        tag: `firstseen-job-${options.jobId}`,
        urgency: options.urgency,
        detailedTitle: `${options.band === "hot" ? "Hot" : "Strong"} match · ${options.company}`,
        detailedBody: options.title,
      },
      notBefore: quiet ? new Date(now.getTime() + deferHours * 3_600_000) : now,
    });
    if (!quiet) await deliverDueWebPush(options.userId, now);
  }
  if (quiet) return notification;
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
        inArray(referrals.status, ["available", "requested", "agreed", "submitted"]),
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
