"use server";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rolloutFlags } from "@/config/rollout";
import { db } from "@/db/client";
import {
  auditEvents,
  applications,
  applicationStageHistory,
  canonicalJobs,
  queueStateHistory,
  queueStates,
  userActions,
} from "@/db/schema";
import { requireOwner } from "@/lib/auth/owner";
import { upsertGlobalQueueState } from "@/lib/supply/user-queue";

const transitionSchema = z.object({
  jobId: z.string().uuid(),
  rowVersion: z.coerce.number().int().positive(),
  status: z.enum(["active", "saved", "applied", "dismissed"]),
});

const actionKindByStatus = {
  active: "restored",
  saved: "saved",
  applied: "applied",
  dismissed: "dismissed",
} as const;

export async function transitionQueue(formData: FormData) {
  const owner = await requireOwner();
  const parsed = transitionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Invalid queue transition");
  const { jobId, rowVersion, status } = parsed.data;
  const actionId = randomUUID();

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        queue: queueStates,
        lifecycleStatus: canonicalJobs.lifecycleStatus,
        globalJobId: canonicalJobs.globalJobId,
      })
      .from(queueStates)
      .innerJoin(canonicalJobs, eq(queueStates.jobId, canonicalJobs.id))
      .where(and(eq(queueStates.userId, owner.id), eq(queueStates.jobId, jobId)))
      .limit(1);
    if (!current) throw new Error("Queue item was not found");
    if (current.queue.rowVersion !== rowVersion)
      throw new Error("This job changed in another tab. Refresh and try again.");
    if (current.queue.status === status) return;
    if (
      status === "active" &&
      current.lifecycleStatus !== "open" &&
      current.lifecycleStatus !== "reopened"
    )
      throw new Error("This official listing is no longer verified as open.");
    const [updated] = await tx
      .update(queueStates)
      .set({
        status,
        rowVersion: rowVersion + 1,
        statusChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(queueStates.userId, owner.id),
          eq(queueStates.jobId, jobId),
          eq(queueStates.rowVersion, rowVersion),
        ),
      )
      .returning({ id: queueStates.id });
    if (!updated) throw new Error("Queue transition conflicted. Refresh and try again.");
    if (current.globalJobId)
      await upsertGlobalQueueState(tx, {
        userId: owner.id,
        globalJobId: current.globalJobId,
        status,
        changedAt: new Date(),
      });
    await tx.insert(userActions).values({
      id: actionId,
      userId: owner.id,
      jobId,
      kind: actionKindByStatus[status],
      idempotencyKey: `${actionId}:${status}`,
      metadata: { source: "portal" },
    });
    await tx.insert(queueStateHistory).values({
      userId: owner.id,
      jobId,
      fromStatus: current.queue.status,
      toStatus: status,
      actionId,
      reason: "User action in portal",
    });
    await tx.insert(auditEvents).values({
      userId: owner.id,
      eventType: "queue.transitioned",
      targetType: "job",
      targetId: jobId,
      metadataSafe: { from: current.queue.status, to: status },
    });
    if (status === "applied" && rolloutFlags().applicationWorkflow) {
      const [existingApplication] = await tx
        .select({ id: applications.id })
        .from(applications)
        .where(and(eq(applications.userId, owner.id), eq(applications.legacyJobId, jobId)))
        .limit(1);
      const [application] = existingApplication
        ? [existingApplication]
        : await tx
            .insert(applications)
            .values({
              userId: owner.id,
              globalJobId: current.globalJobId,
              legacyJobId: jobId,
              stage: "applied",
              appliedAt: new Date(),
              source: "manual_portal",
            })
            .returning({ id: applications.id });
      if (application && !existingApplication)
        await tx.insert(applicationStageHistory).values({
          userId: owner.id,
          applicationId: application.id,
          fromStage: null,
          toStage: "applied",
          reason: "Marked applied in FirstSeen",
        });
    }
  });

  revalidatePath("/");
  revalidatePath("/saved");
  revalidatePath("/applied");
  revalidatePath("/dismissed");
  revalidatePath(`/jobs/${jobId}`);
}
