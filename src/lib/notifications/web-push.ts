import "server-only";

import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import webPush, { type PushSubscription as WebPushSubscription } from "web-push";
import { db } from "@/db/client";
import {
  canonicalJobs,
  companies,
  eligibilityDecisions,
  notificationChannels,
  notificationDeliveries,
  notificationReads,
  notifications,
  pushSubscriptions,
  queueStates,
  recommendations,
  referralRequests,
  referrals,
} from "@/db/schema";
import { serverEnv } from "@/lib/env/server";
import { decryptCapability } from "@/lib/security/encrypted-capability";
import { recordNotificationDeadLetter, resolveNotificationDeadLetter } from "./dead-letter";
import type { PushCapability } from "./push-capability";
import { PUSH_POLICY_VERSION } from "@/domain/notifications/policy";
import { evaluateNotificationPolicy } from "@/domain/notifications/policy";
import type { RoleFamily } from "@/domain/eligibility/types";
import { freshness } from "@/domain/jobs";
import { loadEffectivePushPolicy } from "./preferences";

export type PushMessage = {
  path: string;
  tag: string;
  urgency: number;
  detailedTitle: string;
  detailedBody: string;
};

type PushSender = (
  subscription: WebPushSubscription,
  payload: string,
  options: webPush.RequestOptions,
) => Promise<webPush.SendResult>;

async function revalidateJobAlertDelivery(deliveryId: string, now: Date) {
  const [row] = await db
    .select({
      userId: notificationDeliveries.userId,
      notificationId: notifications.id,
      notificationKind: notifications.kind,
      notificationPayload: notifications.payload,
      jobId: canonicalJobs.id,
      lifecycleStatus: canonicalJobs.lifecycleStatus,
      verifiedAt: canonicalJobs.verifiedAt,
      postedAt: canonicalJobs.postedAt,
      postedAtConfidence: canonicalJobs.postedAtConfidence,
      firstSeenAt: canonicalJobs.firstSeenAt,
      reopenedAt: canonicalJobs.reopenedAt,
      queueStatus: queueStates.status,
      companyId: companies.id,
      organizationId: companies.organizationId,
      interested: companies.interested,
      eligibilityOutcome: eligibilityDecisions.outcome,
      uncertainFields: eligibilityDecisions.uncertainFields,
    })
    .from(notificationDeliveries)
    .innerJoin(notifications, eq(notificationDeliveries.logicalNotificationId, notifications.id))
    .leftJoin(canonicalJobs, eq(notifications.jobId, canonicalJobs.id))
    .leftJoin(companies, eq(canonicalJobs.companyId, companies.id))
    .leftJoin(
      queueStates,
      and(
        eq(queueStates.userId, notificationDeliveries.userId),
        eq(queueStates.jobId, canonicalJobs.id),
      ),
    )
    .leftJoin(
      recommendations,
      and(
        eq(recommendations.userId, notificationDeliveries.userId),
        eq(recommendations.snapshotId, notifications.snapshotId),
      ),
    )
    .leftJoin(
      eligibilityDecisions,
      eq(recommendations.eligibilityDecisionId, eligibilityDecisions.id),
    )
    .where(eq(notificationDeliveries.id, deliveryId))
    .limit(1);
  if (!row || row.notificationKind !== "job_alert") return { allowed: true as const };
  if (
    !row.jobId ||
    !row.organizationId ||
    !row.postedAtConfidence ||
    !row.firstSeenAt ||
    !row.lifecycleStatus ||
    !row.verifiedAt
  )
    return { allowed: false as const, reason: "job_unavailable" };
  const payload = row.notificationPayload as {
    band?: "hot" | "strong" | "possible" | "review" | "not_recommended";
    policyFacts?: {
      roleFamily?: RoleFamily;
      eligibilityOutcome?: "eligible" | "ineligible" | "review";
      uncertainFields?: string[];
    };
  };
  if (!payload.band || !payload.policyFacts?.roleFamily)
    return { allowed: false as const, reason: "policy_context_unavailable" };
  const [legacyReferral, crmReferral] = await Promise.all([
    db
      .select({ id: referrals.id })
      .from(referrals)
      .where(and(eq(referrals.userId, row.userId), eq(referrals.companyId, row.companyId!)))
      .limit(1),
    db
      .select({ id: referralRequests.id })
      .from(referralRequests)
      .where(
        and(
          eq(referralRequests.userId, row.userId),
          eq(referralRequests.organizationId, row.organizationId),
          inArray(referralRequests.status, ["available", "requested", "agreed", "submitted"]),
        ),
      )
      .limit(1),
  ]);
  const { policy, companyOverrideMode } = await loadEffectivePushPolicy(
    row.userId,
    row.organizationId,
  );
  const current = freshness(
    now,
    row.postedAt,
    row.postedAtConfidence,
    row.firstSeenAt,
    row.reopenedAt,
  );
  const decision = evaluateNotificationPolicy(
    {
      officiallyVerified: Boolean(row.verifiedAt),
      lifecycleStatus: row.lifecycleStatus,
      eligibilityOutcome:
        row.eligibilityOutcome ?? payload.policyFacts.eligibilityOutcome ?? "review",
      uncertainFields: row.uncertainFields ?? payload.policyFacts.uncertainFields ?? [],
      queueStatus: row.queueStatus ?? "dismissed",
      band: payload.band,
      roleFamily: payload.policyFacts.roleFamily,
      freshnessAgeHours: current.ageHours,
      freshnessBasis: current.basis,
      timestampReliable: current.basis !== "first_seen",
      hasActiveReferral: legacyReferral.length > 0 || crmReferral.length > 0,
      interestedCompany: Boolean(row.interested),
      companyOverrideMode,
      alreadyAlerted: false,
    },
    policy,
    now,
  );
  return decision.eligible
    ? { allowed: true as const }
    : { allowed: false as const, reason: decision.reason };
}

function statusCode(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : null;
}

async function failClaimedDelivery(options: {
  deliveryId: string;
  subscriptionId?: string | null;
  errorCode: string;
  revoke?: boolean;
}) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(notificationDeliveries)
      .set({
        status: "failed",
        failedAt: now,
        nextAttemptAt: null,
        lastErrorCode: options.errorCode,
        providerResponseSafe: { retryable: false },
        updatedAt: now,
      })
      .where(eq(notificationDeliveries.id, options.deliveryId));
    if (options.subscriptionId)
      await tx
        .update(pushSubscriptions)
        .set({
          revokedAt: options.revoke ? now : undefined,
          failureCount: sql`${pushSubscriptions.failureCount} + 1`,
          updatedAt: now,
        })
        .where(eq(pushSubscriptions.id, options.subscriptionId));
  });
}

export async function queueWebPushDeliveries(options: {
  userId: string;
  logicalNotificationId: string;
  globalJobId?: string | null;
  reason: string;
  message: PushMessage;
  notBefore: Date;
  subscriptionIds?: string[];
}) {
  const subscriptions = await db
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
        ...(options.subscriptionIds?.length
          ? [inArray(pushSubscriptions.id, options.subscriptionIds)]
          : []),
        isNull(pushSubscriptions.revokedAt),
        or(
          isNull(pushSubscriptions.expirationTime),
          gte(pushSubscriptions.expirationTime, new Date()),
        ),
      ),
    );
  const now = new Date();
  if (!subscriptions.length) return [];
  const recentAlertCounts = await db
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
  const deliveryIds: string[] = [];
  const [unread] = await db
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
  for (const subscription of subscriptions) {
    const overflow = (recentBySubscription.get(subscription.id) ?? 0) >= 6;
    const payload = overflow
      ? {
          title: "More fresh FirstSeen matches",
          body: "Several verified jobs are ready to review.",
          path: "/",
          tag: "firstseen-fresh-overflow",
          notificationId: options.logicalNotificationId,
          unreadCount: Number(unread?.count ?? 0),
        }
      : subscription.detailed
        ? {
            title: options.message.detailedTitle,
            body: options.message.detailedBody,
            path: options.message.path,
            tag: options.message.tag,
            notificationId: options.logicalNotificationId,
            unreadCount: Number(unread?.count ?? 0),
          }
        : {
            title: "New FirstSeen match",
            body: `Urgency ${options.message.urgency} · Open FirstSeen to review it.`,
            path: options.message.path,
            tag: options.message.tag,
            notificationId: options.logicalNotificationId,
            unreadCount: Number(unread?.count ?? 0),
          };
    const [delivery] = await db
      .insert(notificationDeliveries)
      .values({
        userId: options.userId,
        logicalNotificationId: options.logicalNotificationId,
        globalJobId: options.globalJobId ?? null,
        channelId: subscription.channelId,
        pushSubscriptionId: subscription.id,
        reason: overflow ? `${options.reason}:overflow` : options.reason,
        policyVersion: PUSH_POLICY_VERSION,
        idempotencyKey: `push:${options.logicalNotificationId}:${subscription.id}`,
        status: options.notBefore > now ? "deferred" : "pending",
        nextAttemptAt: options.notBefore,
        providerResponseSafe: { payload },
      })
      .onConflictDoNothing()
      .returning({ id: notificationDeliveries.id });
    if (delivery) deliveryIds.push(delivery.id);
  }
  return deliveryIds;
}

export async function deliverWebPush(
  deliveryId: string,
  sender: PushSender = webPush.sendNotification,
) {
  const env = serverEnv();
  if (
    !env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    !env.VAPID_PRIVATE_KEY ||
    !env.VAPID_SUBJECT ||
    !env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY
  )
    return { state: "not_configured" as const };
  const now = new Date();
  const revalidated = await revalidateJobAlertDelivery(deliveryId, now);
  if (!revalidated.allowed) {
    const [delivery] = await db
      .update(notificationDeliveries)
      .set({
        status: "suppressed",
        nextAttemptAt: null,
        lastErrorCode: `PUSH_SUPPRESSED_${revalidated.reason.toUpperCase()}`,
        providerResponseSafe: { suppressedReason: revalidated.reason },
        updatedAt: now,
      })
      .where(
        and(
          eq(notificationDeliveries.id, deliveryId),
          inArray(notificationDeliveries.status, ["pending", "failed", "deferred"]),
        ),
      )
      .returning({ logicalNotificationId: notificationDeliveries.logicalNotificationId });
    if (delivery?.logicalNotificationId)
      await db
        .update(notifications)
        .set({ status: "suppressed", updatedAt: now })
        .where(eq(notifications.id, delivery.logicalNotificationId));
    return { state: "suppressed" as const, reason: revalidated.reason };
  }
  const [claimed] = await db
    .update(notificationDeliveries)
    .set({
      status: "sending",
      attemptCount: sql`${notificationDeliveries.attemptCount} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(notificationDeliveries.id, deliveryId),
        inArray(notificationDeliveries.status, ["pending", "failed", "deferred"]),
        lt(notificationDeliveries.attemptCount, 6),
        lte(notificationDeliveries.nextAttemptAt, now),
      ),
    )
    .returning({
      id: notificationDeliveries.id,
      userId: notificationDeliveries.userId,
      subscriptionId: notificationDeliveries.pushSubscriptionId,
      channelId: notificationDeliveries.channelId,
      logicalNotificationId: notificationDeliveries.logicalNotificationId,
      attemptCount: notificationDeliveries.attemptCount,
      response: notificationDeliveries.providerResponseSafe,
    });
  if (!claimed) return { state: "already_claimed" as const };
  if (!claimed.subscriptionId) {
    await failClaimedDelivery({
      deliveryId: claimed.id,
      errorCode: "PUSH_SUBSCRIPTION_UNAVAILABLE",
    });
    return { state: "subscription_unavailable" as const };
  }
  const subscriptionId = claimed.subscriptionId;
  const [subscription] = await db
    .select({ encrypted: pushSubscriptions.encryptedCapability })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, subscriptionId), isNull(pushSubscriptions.revokedAt)))
    .limit(1);
  if (!subscription) {
    await failClaimedDelivery({
      deliveryId: claimed.id,
      subscriptionId,
      errorCode: "PUSH_SUBSCRIPTION_UNAVAILABLE",
    });
    return { state: "subscription_unavailable" as const };
  }
  let capability: PushCapability;
  try {
    capability = decryptCapability<PushCapability>(
      subscription.encrypted,
      env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY,
    );
  } catch {
    await failClaimedDelivery({
      deliveryId: claimed.id,
      subscriptionId,
      errorCode: "PUSH_CAPABILITY_INVALID",
      revoke: true,
    });
    return { state: "invalid_capability" as const };
  }
  const response = claimed.response as { payload?: unknown };
  let result: webPush.SendResult;
  try {
    result = await sender(
      {
        endpoint: capability.endpoint,
        expirationTime: capability.expirationTime,
        keys: capability.keys,
      },
      JSON.stringify(response.payload ?? {}),
      {
        vapidDetails: {
          subject: env.VAPID_SUBJECT,
          publicKey: env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
        },
        TTL: 24 * 60 * 60,
        urgency: "high",
      },
    );
  } catch (error) {
    const code = statusCode(error);
    const expired = code === 404 || code === 410;
    const retryable = code === 429 || code === null || code >= 500;
    const exhausted = claimed.attemptCount >= 6;
    const terminalFailure = (retryable && exhausted) || (!retryable && !expired);
    const errorCode = expired ? "PUSH_SUBSCRIPTION_EXPIRED" : `PUSH_${code ?? "NETWORK"}`;
    const baseBackoffMinutes = Math.min(12 * 60, 15 * 3 ** Math.max(0, claimed.attemptCount - 1));
    const backoffMinutes = Math.round(baseBackoffMinutes * (0.8 + Math.random() * 0.4));
    await db.transaction(async (tx) => {
      await tx
        .update(notificationDeliveries)
        .set({
          status: "failed",
          failedAt: new Date(),
          nextAttemptAt:
            retryable && !expired && !exhausted
              ? new Date(Date.now() + backoffMinutes * 60_000)
              : null,
          lastErrorCode: errorCode,
          providerResponseSafe: { statusCode: code, retryable, expired },
          updatedAt: new Date(),
        })
        .where(eq(notificationDeliveries.id, claimed.id));
      await tx
        .update(pushSubscriptions)
        .set({
          revokedAt: expired ? new Date() : undefined,
          failureCount: sql`${pushSubscriptions.failureCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(pushSubscriptions.id, subscriptionId));
    });
    if (terminalFailure) {
      await recordNotificationDeadLetter({
        payload: { userId: claimed.userId, channel: "web_push", deliveryId: claimed.id },
        errorCode: exhausted ? "PUSH_RETRIES_EXHAUSTED" : errorCode,
        errorMessageSafe: exhausted
          ? "Web Push exhausted its bounded delivery attempts."
          : "Web Push returned a permanent provider failure.",
      });
    }
    return { state: expired ? ("expired" as const) : ("failed" as const), retryable };
  }
  const acceptedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(notificationDeliveries)
      .set({
        status: "delivered",
        acceptedAt,
        nextAttemptAt: null,
        providerResponseSafe: { statusCode: result.statusCode },
        lastErrorCode: null,
        updatedAt: acceptedAt,
      })
      .where(eq(notificationDeliveries.id, claimed.id));
    await tx
      .update(pushSubscriptions)
      .set({ lastUsedAt: acceptedAt, failureCount: 0, updatedAt: acceptedAt })
      .where(eq(pushSubscriptions.id, subscriptionId));
    await tx
      .update(notificationChannels)
      .set({ lastSuccessAt: acceptedAt, lastErrorCode: null, updatedAt: acceptedAt })
      .where(eq(notificationChannels.id, claimed.channelId));
    if (claimed.logicalNotificationId)
      await tx
        .update(notifications)
        .set({ status: "delivered", deliveredAt: acceptedAt, updatedAt: acceptedAt })
        .where(eq(notifications.id, claimed.logicalNotificationId));
  });
  await resolveNotificationDeadLetter({
    userId: claimed.userId,
    channel: "web_push",
    deliveryId: claimed.id,
  });
  return { state: "delivered" as const };
}

export async function deliverDueWebPush(userId: string, now = new Date()) {
  const staleClaims = await db
    .update(notificationDeliveries)
    .set({
      status: "failed",
      nextAttemptAt: null,
      lastErrorCode: "PUSH_DELIVERY_OUTCOME_UNKNOWN",
      updatedAt: now,
    })
    .where(
      and(
        eq(notificationDeliveries.userId, userId),
        eq(notificationDeliveries.status, "sending"),
        lt(notificationDeliveries.updatedAt, new Date(now.getTime() - 10 * 60_000)),
      ),
    )
    .returning({ id: notificationDeliveries.id });
  for (const stale of staleClaims)
    await recordNotificationDeadLetter({
      payload: { userId, channel: "web_push", deliveryId: stale.id },
      errorCode: "PUSH_DELIVERY_OUTCOME_UNKNOWN",
      errorMessageSafe: "Web Push delivery began but its final provider outcome is unknown.",
      now,
    });
  const rows = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.userId, userId),
        inArray(notificationDeliveries.status, ["pending", "failed", "deferred"]),
        lt(notificationDeliveries.attemptCount, 6),
        lte(notificationDeliveries.nextAttemptAt, now),
      ),
    )
    .limit(50);
  let delivered = 0;
  for (const row of rows) {
    try {
      const result = await deliverWebPush(row.id);
      if (result.state === "delivered") delivered += 1;
    } catch {
      // A malformed or undecryptable capability is isolated to this device.
    }
  }
  return { due: rows.length, delivered, unknownOutcomes: staleClaims.length };
}
