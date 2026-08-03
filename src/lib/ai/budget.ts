import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { usageCostLedger } from "@/db/schema";
import { serverEnv } from "@/lib/env/server";

export async function reserveAiBudget(userId: string, idempotencyKey: string, estimateUsd = 0.03) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [usage] = await tx
      .select({ total: sql<string>`coalesce(sum(${usageCostLedger.estimatedCostUsd}), 0)` })
      .from(usageCostLedger)
      .where(
        and(
          eq(usageCostLedger.userId, userId),
          eq(usageCostLedger.provider, "openai"),
          gte(usageCostLedger.occurredAt, monthStart),
          sql`${usageCostLedger.reservationStatus} in ('reserved', 'settled')`,
        ),
      );
    const spent = Number(usage?.total ?? 0);
    if (spent + estimateUsd > serverEnv().OPENAI_MONTHLY_BUDGET_USD) return null;
    const [reservation] = await tx
      .insert(usageCostLedger)
      .values({
        id: randomUUID(),
        userId,
        provider: "openai",
        operation: "job_analysis",
        idempotencyKey,
        units: "1",
        unitName: "analysis",
        estimatedCostUsd: estimateUsd.toFixed(6),
        reservationStatus: "reserved",
      })
      .onConflictDoNothing()
      .returning();
    if (reservation) return reservation.id;
    const [existing] = await tx
      .select({ id: usageCostLedger.id, status: usageCostLedger.reservationStatus })
      .from(usageCostLedger)
      .where(
        and(eq(usageCostLedger.userId, userId), eq(usageCostLedger.idempotencyKey, idempotencyKey)),
      )
      .limit(1);
    return existing?.status === "released" ? null : (existing?.id ?? null);
  });
}

export async function settleAiBudget(
  reservationId: string,
  actualUsd: number,
  metadata: Record<string, unknown>,
) {
  await db
    .update(usageCostLedger)
    .set({
      actualCostUsd: actualUsd.toFixed(6),
      estimatedCostUsd: actualUsd.toFixed(6),
      reservationStatus: "settled",
      metadata,
      updatedAt: new Date(),
    })
    .where(eq(usageCostLedger.id, reservationId));
}
export async function releaseAiBudget(reservationId: string, errorCode: string) {
  await db
    .update(usageCostLedger)
    .set({
      estimatedCostUsd: "0",
      reservationStatus: "released",
      metadata: { errorCode },
      updatedAt: new Date(),
    })
    .where(eq(usageCostLedger.id, reservationId));
}
