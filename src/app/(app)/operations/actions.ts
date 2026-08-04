"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { careerSources, deadLetterRecords } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { requireOwner } from "@/lib/auth/owner";
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
    .select({ id: careerSources.id })
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
}

export async function requestSourceScan(formData: FormData) {
  const owner = await requireOwner();
  await enforceOperationsRateLimit(owner.id, "manual-source-scan");
  const sourceId = z.string().uuid().parse(formData.get("sourceId"));
  await requireActiveOwnedSource(owner.id, sourceId);
  await inngest.send({
    name: "firstseen/source.scan.requested",
    data: { userId: owner.id, sourceId, scheduledFor: new Date().toISOString() },
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
  const payload = z
    .object({ userId: z.string().uuid(), sourceId: z.string().uuid() })
    .parse(record.eventPayload);
  if (payload.userId !== owner.id) throw new Error("Dead letter ownership is invalid");
  await requireActiveOwnedSource(owner.id, payload.sourceId);
  const sent = await inngest.send({
    name: "firstseen/source.scan.requested",
    data: { ...payload, scheduledFor: new Date().toISOString() },
  });
  await db
    .update(deadLetterRecords)
    .set({ replayedAt: new Date(), replayEventId: sent.ids[0] ?? null, updatedAt: new Date() })
    .where(eq(deadLetterRecords.id, id));
  revalidatePath("/operations");
  redirect("/operations?started=replay");
}
