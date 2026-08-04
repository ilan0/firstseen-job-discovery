import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { userJobQueueStates } from "@/db/schema";

type QueueStatus = "active" | "saved" | "applied" | "dismissed";

type GlobalQueueProjection = {
  userId: string;
  globalJobId: string;
  status: QueueStatus;
  changedAt: Date;
};

async function upsertGlobalQueueState(
  writer: Pick<typeof db, "insert">,
  projection: GlobalQueueProjection,
) {
  await writer
    .insert(userJobQueueStates)
    .values({
      userId: projection.userId,
      jobId: projection.globalJobId,
      status: projection.status,
      statusChangedAt: projection.changedAt,
    })
    .onConflictDoUpdate({
      target: [userJobQueueStates.userId, userJobQueueStates.jobId],
      set: {
        status: projection.status,
        rowVersion: sql`${userJobQueueStates.rowVersion} + 1`,
        statusChangedAt: projection.changedAt,
        updatedAt: projection.changedAt,
      },
    });
}

export async function projectGlobalQueueState(projection: GlobalQueueProjection) {
  await upsertGlobalQueueState(db, projection);
}

export { upsertGlobalQueueState };
