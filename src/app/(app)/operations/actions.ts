"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { careerSources, deadLetterRecords, globalScanRuns } from "@/db/schema";
import { rolloutFlags } from "@/config/rollout";
import { inngest } from "@/inngest/client";
import { requireOwner } from "@/lib/auth/owner";
import {
  notificationDeadLetterPayloadSchema,
  resetNotificationDeliveryForReplay,
} from "@/lib/notifications/dead-letter";
import { consumeRateLimit } from "@/lib/security/rate-limit";

async function enforceOperationsRateLimit(ownerId: string, namespace: string) {
  const result = await consumeRateLimit({
    namespace,
    identifier: ownerId,
    maximum: 10,
    windowMinutes: 1,
    blockMinutes: 5,
  });
  if (!result.allowed) throw new Error("Too many requests. Try again in a few minutes.");
}

async function requireActiveOwnedSource(ownerId: string, sourceId: string) {
  const [source] = await db
    .select({ id: careerSources.id, globalSourceId: careerSources.globalSourceId })
    .from(careerSources)
    .where(
      and(
        eq(careerSources.userId, ownerId),
        eq(careerSources.id, sourceId),
        eq(careerSources.active, true),
      ),
    )
    .limit(1);
  if (!source) throw new Error("Active source was not found");
  return source;
}

async function dispatchDeadLetterReplay(
  record: { eventName: string; eventPayload: unknown },
  ownerId: string,
  now: Date,
) {
  if (record.eventName === "firstseen/notification.delivery.failed") {
    const payload = notificationDeadLetterPayloadSchema.parse(record.eventPayload);
    if (payload.userId !== ownerId) throw new Error("Dead letter ownership is invalid");
    if (!(await resetNotificationDeliveryForReplay(payload, now)))
      throw new Error("Failed notification is no longer replayable");
    return inngest.send({
      name: "firstseen/user.notifications.requested",
      data: { userId: ownerId, scheduledFor: now.toISOString() },
    });
  }
  const payload = z
    .object({ userId: z.string().uuid(), sourceId: z.string().uuid() })
    .parse(record.eventPayload);
  if (payload.userId !== ownerId) throw new Error("Dead letter ownership is invalid");
  await requireActiveOwnedSource(ownerId, payload.sourceId);
  return inngest.send({
    name: "firstseen/source.scan.requested",
    data: { ...payload, scheduledFor: now.toISOString() },
  });
}

export async function requestSourceScan(formData: FormData) {
  const owner = await requireOwner();
  await enforceOperationsRateLimit(owner.id, "manual-source-scan");
  const sourceId = z.string().uuid().parse(formData.get("sourceId"));
  const source = await requireActiveOwnedSource(owner.id, sourceId);
  const scheduledFor = new Date();
  if (rolloutFlags().globalSupply && source.globalSourceId) {
    const [run] = await db
      .insert(globalScanRuns)
      .values({
        careerSourceId: source.globalSourceId,
        status: "queued",
        idempotencyKey: `manual:${owner.id}:${source.globalSourceId}:${scheduledFor.toISOString()}`,
        scheduledFor,
      })
      .returning({ id: globalScanRuns.id });
    if (!run) throw new Error("Global scan could not be queued");
    await inngest.send({
      id: run.id,
      name: "supply/source.scan.requested.v2",
      data: {
        sourceId: source.globalSourceId,
        scanRunId: run.id,
        scheduledFor: scheduledFor.toISOString(),
      },
    });
  } else
    await inngest.send({
      name: "firstseen/source.scan.requested",
      data: { userId: owner.id, sourceId, scheduledFor: scheduledFor.toISOString() },
    });
  revalidatePath("/operations");
  redirect("/operations?started=scan");
}

export async function requestBroadDiscovery() {
  const owner = await requireOwner();
  await enforceOperationsRateLimit(owner.id, "manual-broad-discovery");
  await inngest.send({
    name: "firstseen/broad-discovery.requested",
    data: { userId: owner.id, requestedAt: new Date().toISOString() },
  });
  revalidatePath("/operations");
  redirect("/operations?started=discovery");
}

export async function replayDeadLetter(formData: FormData) {
  const owner = await requireOwner();
  await enforceOperationsRateLimit(owner.id, "dead-letter-replay");
  const id = z.string().uuid().parse(formData.get("deadLetterId"));
  const [record] = await db
    .select()
    .from(deadLetterRecords)
    .where(and(eq(deadLetterRecords.userId, owner.id), eq(deadLetterRecords.id, id)))
    .limit(1);
  if (!record || record.resolvedAt)
    throw new Error("Dead letter was not found or is already resolved");
  const now = new Date();
  const sent = await dispatchDeadLetterReplay(record, owner.id, now);
  await db
    .update(deadLetterRecords)
    .set({ replayedAt: now, replayEventId: sent.ids[0] ?? null, updatedAt: now })
    .where(eq(deadLetterRecords.id, id));
  revalidatePath("/operations");
  redirect("/operations?started=replay");
}
