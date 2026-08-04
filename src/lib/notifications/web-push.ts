import "server-only";

import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import webPush, { type PushSubscription as WebPushSubscription } from "web-push";
import { db } from "@/db/client";
import {
  notificationChannels,
  notificationDeliveries,
  notificationPreferences,
  notificationReads,
  notifications,
  pushSubscriptions,
} from "@/db/schema";
import { serverEnv } from "@/lib/env/server";
import { decryptCapability } from "@/lib/security/encrypted-capability";
import { recordNotificationDeadLetter, resolveNotificationDeadLetter } from "./dead-letter";
import type { PushCapability } from "./push-capability";

export const PUSH_POLICY_VERSION = "2026-08-04.1";

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
}) {
  const subscriptions = await db
    .select({
      id: pushSubscriptions.id,
      channelId: pushSubscriptions.channelId,
      detailed: notificationPreferences.detailedLockScreen,
    })
    .from(pushSubscriptions)
    .innerJoin(notificationChannels, eq(pushSubscriptions.channelId, notificationChannels.id))
    .leftJoin(
      notificationPreferences,
      and(
        eq(notificationPreferences.channelId, notificationChannels.id),
        isNull(notificationPreferences.organizationId),
      ),
    )
    .where(
      and(
        eq(pushSubscriptions.userId, options.userId),
        eq(notificationChannels.enabled, true),
        isNull(pushSubscriptions.revokedAt),
        or(
          isNull(pushSubscriptions.expirationTime),
          gte(pushSubscriptions.expirationTime, new Date()),
        ),
      ),
    );
  const now = new Date();
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
    const payload = subscription.detailed
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
    await db
      .insert(notificationDeliveries)
      .values({
        userId: options.userId,
        logicalNotificationId: options.logicalNotificationId,
        globalJobId: options.globalJobId ?? null,
        channelId: subscription.channelId,
        pushSubscriptionId: subscription.id,
        reason: options.reason,
        policyVersion: PUSH_POLICY_VERSION,
        idempotencyKey: `push:${options.logicalNotificationId}:${subscription.id}:${PUSH_POLICY_VERSION}`,
        status: options.notBefore > now ? "deferred" : "pending",
        nextAttemptAt: options.notBefore,
        providerResponseSafe: { payload },
      })
      .onConflictDoNothing();
  }
  return subscriptions.length;
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
