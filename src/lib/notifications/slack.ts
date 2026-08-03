import "server-only";
import { and, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { digestDeliveries, notifications } from "@/db/schema";
import { serverEnv } from "@/lib/env/server";
import type { SlackPayload } from "./slack-payload";
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
      attemptCount: notifications.attemptCount,
      payload: notifications.payload,
    });
  if (!claimed) return { state: "already_claimed" as const };
  const effectivePayload = payload ?? (claimed.payload as SlackPayload);
  try {
    const response = await postSlack(effectivePayload, fetcher);
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
    return { state: "delivered" as const };
  } catch (error) {
    const backoffMinutes = Math.min(360, 5 * 2 ** Math.max(0, claimed.attemptCount - 1));
    await db
      .update(notifications)
      .set({
        status: "failed",
        deferredUntil: new Date(now.getTime() + backoffMinutes * 60_000),
        lastErrorCode: error instanceof Error ? error.name.toUpperCase() : "SLACK_FAILED",
        updatedAt: new Date(),
      })
      .where(eq(notifications.id, notificationId));
    throw error;
  }
}

export async function retryFailedNotifications(userId: string, now = new Date()) {
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
  return { due: due.length, delivered };
}
