import { and, eq, lt, lte, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import { ConnectorError } from "@/connectors/errors";
import { db } from "@/db/client";
import {
  candidateProfiles,
  deadLetterRecords,
  rawObservations,
  scanRuns,
  scanSourceRuns,
  securityRateLimits,
  watchlists,
  workerAttempts,
} from "@/db/schema";
import { discoverBroadSources } from "@/lib/discovery/broad";
import {
  deliverDeferredAlerts,
  deliverMorningDigest,
  queueExceptionalAlert,
} from "@/lib/notifications/orchestrate";
import { retryFailedNotifications } from "@/lib/notifications/slack";
import {
  finalizeStagedSource,
  loadActiveSources,
  processStagedListing,
  stageStoredSource,
} from "@/lib/scans/scan-source";
import { recordSourceScanFailure } from "@/lib/scans/record-failure";
import { inngest } from "./client";

const sourceEventSchema = z.object({
  userId: z.string().uuid(),
  sourceId: z.string().uuid(),
  scheduledFor: z.string().datetime(),
  scanKind: z.enum(["watchlist", "broad_discovery", "closure"]).default("watchlist"),
});

export const watchlistScheduler = inngest.createFunction(
  { id: "watchlist-scheduler", triggers: [{ cron: "*/15 * * * *" }] },
  async ({ step }) => {
    const due = await step.run("lease-due-watchlists", async () => {
      const now = new Date();
      const rows = await db
        .select()
        .from(watchlists)
        .where(and(eq(watchlists.active, true), lte(watchlists.nextScanAt, now)))
        .limit(100);
      const events: Array<{ userId: string; sourceId: string; scheduledFor: string }> = [];
      for (const row of rows) {
        const [leased] = await db
          .update(watchlists)
          .set({
            nextScanAt: new Date(now.getTime() + row.cadenceMinutes * 60_000),
            updatedAt: now,
          })
          .where(and(eq(watchlists.id, row.id), lte(watchlists.nextScanAt, now)))
          .returning({ companyId: watchlists.companyId });
        if (!leased) continue;
        const sources = await loadActiveSources(row.userId, row.companyId);
        events.push(
          ...sources.map((source) => ({
            userId: row.userId,
            sourceId: source.id,
            scheduledFor: now.toISOString(),
            scanKind: "watchlist" as const,
          })),
        );
      }
      return events;
    });
    if (due.length)
      await step.sendEvent(
        "dispatch-source-scans",
        due.map((data) => ({ name: "firstseen/source.scan.requested", data })),
      );
    return { dispatched: due.length };
  },
);

export const sourceScan = inngest.createFunction(
  {
    id: "source-scan",
    triggers: [{ event: "firstseen/source.scan.requested" }],
    retries: 4,
    concurrency: [{ limit: 3, key: "event.data.userId" }],
    onFailure: async ({ event, error }) => {
      const original = sourceEventSchema.safeParse(event.data.event.data);
      if (!original.success) return;
      const data = original.data;
      const idempotencyKey = `source:${data.sourceId}:${data.scheduledFor}`;
      await recordSourceScanFailure({
        userId: data.userId,
        sourceId: data.sourceId,
        idempotencyKey,
        failureEventId: event.data.run_id,
        originalEventId: event.data.event.id,
        eventPayload: data,
        error,
      });
    },
  },
  async ({ event, step }) => {
    const data = sourceEventSchema.parse(event.data);
    const idempotencyKey = `source:${data.sourceId}:${data.scheduledFor}`;
    const started = await step.run("record-start", async () => {
      const [run] = await db
        .insert(scanRuns)
        .values({
          userId: data.userId,
          kind: data.scanKind,
          status: "running",
          trigger: "inngest",
          idempotencyKey,
          scheduledFor: new Date(data.scheduledFor),
          startedAt: new Date(),
          sourceCount: 1,
        })
        .onConflictDoNothing()
        .returning({ id: scanRuns.id });
      const runId =
        run?.id ??
        (
          await db
            .select({ id: scanRuns.id })
            .from(scanRuns)
            .where(eq(scanRuns.idempotencyKey, idempotencyKey))
            .limit(1)
        )[0]?.id;
      if (!runId) throw new Error("Scan run could not be created");
      const [sourceRun] = await db
        .insert(scanSourceRuns)
        .values({
          userId: data.userId,
          scanRunId: runId,
          careerSourceId: data.sourceId,
          status: "running",
          attemptCount: 1,
          startedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [scanSourceRuns.scanRunId, scanSourceRuns.careerSourceId],
          set: {
            status: "running",
            attemptCount: sql`${scanSourceRuns.attemptCount} + 1`,
            startedAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning({ id: scanSourceRuns.id });
      if (!sourceRun) throw new Error("Source run could not be created");
      await db
        .insert(workerAttempts)
        .values({
          userId: data.userId,
          workflowName: "source-scan",
          eventId: event.id ?? idempotencyKey,
          stepName: "scan",
          status: "running",
          attemptNumber: 0,
          startedAt: new Date(),
        })
        .onConflictDoNothing();
      return { runId, sourceRunId: sourceRun.id };
    });
    const source = await step.run("load-source", async () => {
      const activeSource = (await loadActiveSources(data.userId)).find(
        (item) => item.id === data.sourceId,
      );
      if (!activeSource) throw new Error("Active source not found");
      return activeSource;
    });
    const observedAt = new Date(data.scheduledFor);
    const staged = await step.run("discover-and-stage", async () => {
      try {
        return await stageStoredSource(source, observedAt, started.sourceRunId);
      } catch (error) {
        if (error instanceof ConnectorError && !error.retryable)
          throw new NonRetriableError(`[${error.code}] ${error.message}`, { cause: error });
        throw error;
      }
    });
    const processed: Awaited<ReturnType<typeof processStagedListing>>[] = [];
    for (const observationId of staged.observationIds)
      processed.push(
        await step.run(`process-${observationId}`, () =>
          processStagedListing(source, observationId),
        ),
      );
    const result = await step.run("finalize-source", () =>
      finalizeStagedSource(source, staged, processed, observedAt),
    );
    for (const alert of "exceptional" in result ? result.exceptional : [])
      await step.run(`alert-${alert.jobId}`, () =>
        queueExceptionalAlert({ userId: data.userId, ...alert }),
      );
    await step.run("record-success", async () => {
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(scanSourceRuns)
          .set({
            status: "succeeded",
            finishedAt: now,
            observationCount: result.discovered,
            metrics: result,
            updatedAt: now,
          })
          .where(eq(scanSourceRuns.id, started.sourceRunId));
        await tx
          .update(scanRuns)
          .set({
            status: "succeeded",
            finishedAt: now,
            discoveredCount: result.discovered,
            changedCount: result.changed,
            summary: result,
            updatedAt: now,
          })
          .where(eq(scanRuns.id, started.runId));
        await tx
          .update(workerAttempts)
          .set({ status: "succeeded", finishedAt: now, metrics: result, updatedAt: now })
          .where(
            and(
              eq(workerAttempts.eventId, event.id ?? idempotencyKey),
              eq(workerAttempts.stepName, "scan"),
            ),
          );
        if (event.id)
          await tx
            .update(deadLetterRecords)
            .set({ resolvedAt: now, updatedAt: now })
            .where(
              and(
                eq(deadLetterRecords.userId, data.userId),
                eq(deadLetterRecords.replayEventId, event.id),
              ),
            );
      });
    });
    return result;
  },
);

export const broadDiscovery = inngest.createFunction(
  {
    id: "broad-discovery",
    triggers: [{ cron: "17 */4 * * *" }, { event: "firstseen/broad-discovery.requested" }],
    retries: 2,
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const users = await step.run("load-users", () =>
      db.select({ userId: candidateProfiles.userId }).from(candidateProfiles),
    );
    const scheduledFor = new Date().toISOString();
    const results = [];
    for (const user of users) {
      const discovered = await step.run(`discover-${user.userId}`, () =>
        discoverBroadSources(user.userId),
      );
      if (discovered.sourceIds.length)
        await step.sendEvent(
          `verify-${user.userId}`,
          discovered.sourceIds.map((sourceId) => ({
            name: "firstseen/source.scan.requested" as const,
            data: {
              userId: user.userId,
              sourceId,
              scheduledFor,
              scanKind: "broad_discovery" as const,
            },
          })),
        );
      results.push({ ...discovered, dispatched: discovered.sourceIds.length });
    }
    return results;
  },
);

export const notificationSchedule = inngest.createFunction(
  { id: "notification-schedule", triggers: [{ cron: "7 * * * *" }], retries: 3 },
  async ({ step }) => {
    const users = await step.run("load-users", () =>
      db.select({ userId: candidateProfiles.userId }).from(candidateProfiles),
    );
    const results = [];
    for (const user of users) {
      results.push(
        await step.run(`digest-${user.userId}`, () => deliverMorningDigest(user.userId)),
      );
      await step.run(`deferred-${user.userId}`, () => deliverDeferredAlerts(user.userId));
      await step.run(`retry-failed-${user.userId}`, () => retryFailedNotifications(user.userId));
    }
    return results;
  },
);

export const cleanupSchedule = inngest.createFunction(
  { id: "retention-cleanup", triggers: [{ cron: "43 3 * * *" }], retries: 2 },
  async ({ step }) =>
    step.run("cleanup-expired-records", async () => {
      const observations = await db
        .delete(rawObservations)
        .where(lte(rawObservations.expiresAt, new Date()))
        .returning({ id: rawObservations.id });
      const rateLimits = await db
        .delete(securityRateLimits)
        .where(lt(securityRateLimits.windowStartedAt, new Date(Date.now() - 7 * 86_400_000)))
        .returning({ keyHash: securityRateLimits.keyHash });
      return { observationsDeleted: observations.length, rateLimitsDeleted: rateLimits.length };
    }),
);

export const functions = [
  watchlistScheduler,
  sourceScan,
  broadDiscovery,
  notificationSchedule,
  cleanupSchedule,
];
