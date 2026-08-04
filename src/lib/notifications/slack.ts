import "server-only";
import { and, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { digestDeliveries, notifications } from "@/db/schema";
import { serverEnv } from "@/lib/env/server";
import type { SlackPayload } from "./slack-payload";
import { recordNotificationDeadLetter, resolveNotificationDeadLetter } from "./dead-letter";
import { postSlackWebhook, type SlackFetch } from "./slack-webhook";

export async function postSlack(payload: SlackPayload, fetcher: SlackFetch = fetch) {
  return postSlackWebhook(serverEnv().SLACK_WEBHOOK_URL, payload, fetcher);
}

export async function deliverPendingNotification(
  notificationId: string,
  payload?: SlackPayload,
  fetcher: SlackFetch = fetch,
) {
  const now = new Date();
  const [claimed] = await db
    .update(notifications)
    .set({
      status: "sending",
      attemptCount: sql`${notifications.attemptCount} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(notifications.id, notificationId),
        inArray(notifications.status, ["pending", "failed"]),
        lt(notifications.attemptCount, 5),
        lte(notifications.deferredUntil, now),
      ),
    )
    .returning({
      id: notifications.id,
      userId: notifications.userId,
      attemptCount: notifications.attemptCount,
      payload: notifications.payload,
    });
  if (!claimed) return { state: "already_claimed" as const };
  const effectivePayload = payload ?? (claimed.payload as SlackPayload);
  let response: { status: number };
  try {
    response = await postSlack(effectivePayload, fetcher);
  } catch (error) {
    const backoffMinutes = Math.min(360, 5 * 2 ** Math.max(0, claimed.attemptCount - 1));
    const [failed] = await db
      .update(notifications)
      .set({
        status: "failed",
        deferredUntil:
          claimed.attemptCount >= 5 ? null : new Date(now.getTime() + backoffMinutes * 60_000),
        lastErrorCode: error instanceof Error ? error.name.toUpperCase() : "SLACK_FAILED",
        updatedAt: new Date(),
      })
      .where(eq(notifications.id, notificationId))
      .returning({ userId: notifications.userId });
    if (claimed.attemptCount >= 5 && failed)
      await recordNotificationDeadLetter({
        payload: { userId: failed.userId, channel: "slack", notificationId },
        errorCode: "SLACK_RETRIES_EXHAUSTED",
        errorMessageSafe: "Slack notification exhausted its bounded delivery attempts.",
      });
    throw error;
  }
  const deliveredAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(notifications)
      .set({
        status: "delivered",
        deliveredAt,
        providerResponseSafe: response,
        updatedAt: deliveredAt,
      })
      .where(eq(notifications.id, notificationId));
    await tx
      .update(digestDeliveries)
      .set({ status: "delivered", deliveredAt, updatedAt: deliveredAt })
      .where(eq(digestDeliveries.notificationId, notificationId));
  });
  await resolveNotificationDeadLetter({
    userId: claimed.userId,
    channel: "slack",
    notificationId,
  });
  return { state: "delivered" as const };
}

export async function retryFailedNotifications(userId: string, now = new Date()) {
  const staleClaims = await db
    .update(notifications)
    .set({
      status: "failed",
      deferredUntil: null,
      lastErrorCode: "SLACK_DELIVERY_OUTCOME_UNKNOWN",
      updatedAt: now,
    })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.status, "sending"),
        lt(notifications.updatedAt, new Date(now.getTime() - 10 * 60_000)),
      ),
    )
    .returning({ id: notifications.id });
  for (const stale of staleClaims)
    await recordNotificationDeadLetter({
      payload: { userId, channel: "slack", notificationId: stale.id },
      errorCode: "SLACK_DELIVERY_OUTCOME_UNKNOWN",
      errorMessageSafe: "Slack delivery began but its final provider outcome is unknown.",
      now,
    });
  const due = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.status, "failed"),
        lt(notifications.attemptCount, 5),
        lte(notifications.deferredUntil, now),
      ),
    )
    .limit(20);
  let delivered = 0;
  for (const item of due) {
    try {
      const result = await deliverPendingNotification(item.id);
      if (result.state === "delivered") delivered += 1;
    } catch {
      // The next exponential-backoff attempt remains durable in the database.
    }
  }
  return { due: due.length, delivered, unknownOutcomes: staleClaims.length };
}
