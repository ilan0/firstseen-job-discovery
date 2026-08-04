import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { careerSources, companies, globalScanSchedules, watchlists } from "@/db/schema";
import { deriveGlobalMonitoringDemand } from "@/domain/companies/monitoring";

export async function refreshGlobalSourceDemand(sourceIds: string[], now = new Date()) {
  const uniqueSourceIds = [...new Set(sourceIds)];
  if (!uniqueSourceIds.length) return [];
  const [schedules, demands] = await Promise.all([
    db
      .select()
      .from(globalScanSchedules)
      .where(inArray(globalScanSchedules.careerSourceId, uniqueSourceIds)),
    db
      .select({
        sourceId: careerSources.globalSourceId,
        tier: watchlists.monitoringTier,
        cadenceMinutes: watchlists.cadenceMinutes,
      })
      .from(careerSources)
      .innerJoin(
        companies,
        and(eq(companies.id, careerSources.companyId), eq(companies.userId, careerSources.userId)),
      )
      .innerJoin(
        watchlists,
        and(eq(watchlists.companyId, companies.id), eq(watchlists.userId, careerSources.userId)),
      )
      .where(
        and(
          inArray(careerSources.globalSourceId, uniqueSourceIds),
          eq(careerSources.active, true),
          eq(companies.active, true),
          eq(watchlists.active, true),
        ),
      ),
  ]);
  const updated = [];
  for (const sourceId of uniqueSourceIds) {
    const current = schedules.find((schedule) => schedule.careerSourceId === sourceId);
    if (!current) continue;
    const policy = deriveGlobalMonitoringDemand(
      demands.flatMap((demand) =>
        demand.sourceId === sourceId
          ? [{ tier: demand.tier, cadenceMinutes: demand.cadenceMinutes }]
          : [],
      ),
    );
    const nextRunAt =
      policy.cadenceMinutes < current.cadenceMinutes && current.nextRunAt > now
        ? now
        : policy.cadenceMinutes > current.cadenceMinutes
          ? new Date(now.getTime() + policy.cadenceMinutes * 60_000)
          : current.nextRunAt;
    await db
      .update(globalScanSchedules)
      .set({
        monitoringTier: policy.tier,
        cadenceMinutes: policy.cadenceMinutes,
        nextRunAt,
        demandVersion: current.demandVersion + 1,
        updatedAt: now,
      })
      .where(eq(globalScanSchedules.id, current.id));
    updated.push({ sourceId, ...policy, nextRunAt });
  }
  return updated;
}
