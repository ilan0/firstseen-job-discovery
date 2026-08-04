import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { deadLetterRecords, notificationDeliveries, notifications } from "@/db/schema";

export const notificationDeadLetterPayloadSchema = z.discriminatedUnion("channel", [
  z.object({
    userId: z.string().uuid(),
    channel: z.literal("slack"),
    notificationId: z.string().uuid(),
  }),
  z.object({
    userId: z.string().uuid(),
    channel: z.literal("web_push"),
    deliveryId: z.string().uuid(),
  }),
]);

export type NotificationDeadLetterPayload = z.infer<typeof notificationDeadLetterPayloadSchema>;

export function notificationDeadLetterEventId(payload: NotificationDeadLetterPayload) {
  return payload.channel === "slack"
    ? `notification-slack:${payload.notificationId}`
    : `notification-push:${payload.deliveryId}`;
}

export async function recordNotificationDeadLetter(options: {
  payload: NotificationDeadLetterPayload;
  errorCode: string;
  errorMessageSafe: string;
  now?: Date;
}) {
  const now = options.now ?? new Date();
  const eventId = notificationDeadLetterEventId(options.payload);
  const [record] = await db
    .insert(deadLetterRecords)
    .values({
      userId: options.payload.userId,
      workflowName: "notification-delivery",
      eventId,
      eventName: "firstseen/notification.delivery.failed",
      eventPayload: options.payload,
      errorCode: options.errorCode.slice(0, 120),
      errorMessageSafe: options.errorMessageSafe.slice(0, 500),
      failedAt: now,
    })
    .onConflictDoUpdate({
      target: deadLetterRecords.eventId,
      set: {
        eventPayload: options.payload,
        errorCode: options.errorCode.slice(0, 120),
        errorMessageSafe: options.errorMessageSafe.slice(0, 500),
        failedAt: now,
        replayedAt: null,
        replayEventId: null,
        resolvedAt: null,
        updatedAt: now,
      },
    })
    .returning({ id: deadLetterRecords.id });
  return record ?? null;
}

export async function resolveNotificationDeadLetter(
  payload: NotificationDeadLetterPayload,
  now = new Date(),
) {
  return db
    .update(deadLetterRecords)
    .set({ resolvedAt: now, updatedAt: now })
    .where(
      and(
        eq(deadLetterRecords.userId, payload.userId),
        eq(deadLetterRecords.eventId, notificationDeadLetterEventId(payload)),
      ),
    );
}

export async function resetNotificationDeliveryForReplay(
  payload: NotificationDeadLetterPayload,
  now = new Date(),
) {
  if (payload.channel === "slack") {
    const [reset] = await db
      .update(notifications)
      .set({
        status: "failed",
        attemptCount: 0,
        deferredUntil: now,
        lastErrorCode: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(notifications.userId, payload.userId),
          eq(notifications.id, payload.notificationId),
          eq(notifications.status, "failed"),
        ),
      )
      .returning({ id: notifications.id });
    return Boolean(reset);
  }
  const [reset] = await db
    .update(notificationDeliveries)
    .set({
      status: "failed",
      attemptCount: 0,
      nextAttemptAt: now,
      failedAt: null,
      lastErrorCode: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(notificationDeliveries.userId, payload.userId),
        eq(notificationDeliveries.id, payload.deliveryId),
        eq(notificationDeliveries.status, "failed"),
      ),
    )
    .returning({ id: notificationDeliveries.id });
  return Boolean(reset);
}
