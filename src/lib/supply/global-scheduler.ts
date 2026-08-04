import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { globalOutboxEvents, globalScanRuns, globalScanSchedules } from "@/db/schema";

export const GLOBAL_SCAN_EVENT = "supply/source.scan.requested.v2";

export type PendingGlobalScan = {
  id: string;
  eventName: typeof GLOBAL_SCAN_EVENT;
  payload: {
    sourceId: string;
    scanRunId: string;
    scheduledFor: string;
  };
};

export async function claimDueGlobalSources(now = new Date(), limit = 100) {
  const due = await db
    .select()
    .from(globalScanSchedules)
    .where(
      and(
        eq(globalScanSchedules.active, true),
        lte(globalScanSchedules.nextRunAt, now),
        or(isNull(globalScanSchedules.leasedUntil), lte(globalScanSchedules.leasedUntil, now)),
      ),
    )
    .orderBy(
      asc(globalScanSchedules.nextRunAt),
      sql`case ${globalScanSchedules.monitoringTier} when 'priority' then 0 when 'standard' then 1 when 'warm' then 2 when 'cold' then 3 else 4 end`,
      asc(globalScanSchedules.id),
    )
    .limit(limit);

  let claimed = 0;
  for (const schedule of due) {
    const accepted = await db.transaction(async (tx) => {
      const [lease] = await tx
        .update(globalScanSchedules)
        .set({
          leaseToken: randomUUID(),
          leasedUntil: new Date(now.getTime() + 10 * 60_000),
          nextRunAt: new Date(now.getTime() + schedule.cadenceMinutes * 60_000),
          updatedAt: now,
        })
        .where(
          and(
            eq(globalScanSchedules.id, schedule.id),
            lte(globalScanSchedules.nextRunAt, now),
            or(isNull(globalScanSchedules.leasedUntil), lte(globalScanSchedules.leasedUntil, now)),
          ),
        )
        .returning({ id: globalScanSchedules.id });
      if (!lease) return false;

      const scanKey = `global-source:${schedule.careerSourceId}:${schedule.nextRunAt.toISOString()}`;
      const [created] = await tx
        .insert(globalScanRuns)
        .values({
          careerSourceId: schedule.careerSourceId,
          scheduleId: schedule.id,
          status: "queued",
          idempotencyKey: scanKey,
          scheduledFor: schedule.nextRunAt,
        })
        .onConflictDoNothing()
        .returning({ id: globalScanRuns.id });
      const scanRunId =
        created?.id ??
        (
          await tx
            .select({ id: globalScanRuns.id })
            .from(globalScanRuns)
            .where(eq(globalScanRuns.idempotencyKey, scanKey))
            .limit(1)
        )[0]?.id;
      if (!scanRunId) throw new Error("Claimed global scan run could not be loaded.");

      await tx
        .insert(globalOutboxEvents)
        .values({
          scanRunId,
          eventName: GLOBAL_SCAN_EVENT,
          aggregateId: schedule.careerSourceId,
          idempotencyKey: `global-outbox:${scanKey}`,
          availableAt: now,
          payload: {
            sourceId: schedule.careerSourceId,
            scanRunId,
            scheduledFor: schedule.nextRunAt.toISOString(),
          },
        })
        .onConflictDoNothing();
      return true;
    });
    if (accepted) claimed += 1;
  }
  return claimed;
}

export async function loadPendingGlobalScans(
  now = new Date(),
  limit = 500,
): Promise<PendingGlobalScan[]> {
  const records = await db
    .select({
      id: globalOutboxEvents.id,
      eventName: globalOutboxEvents.eventName,
      payload: globalOutboxEvents.payload,
    })
    .from(globalOutboxEvents)
    .where(
      and(
        eq(globalOutboxEvents.status, "pending"),
        eq(globalOutboxEvents.eventName, GLOBAL_SCAN_EVENT),
        lte(globalOutboxEvents.availableAt, now),
      ),
    )
    .orderBy(asc(globalOutboxEvents.availableAt), asc(globalOutboxEvents.id))
    .limit(limit);
  return records as PendingGlobalScan[];
}

export async function markGlobalScansDispatched(ids: string[], now = new Date()) {
  if (!ids.length) return 0;
  const records = await db
    .update(globalOutboxEvents)
    .set({
      status: "dispatched",
      dispatchedAt: now,
      attemptCount: sql`${globalOutboxEvents.attemptCount} + 1`,
      updatedAt: now,
    })
    .where(and(eq(globalOutboxEvents.status, "pending"), inArray(globalOutboxEvents.id, ids)))
    .returning({ id: globalOutboxEvents.id });
  return records.length;
}
