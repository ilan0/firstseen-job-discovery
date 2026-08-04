import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import { ConnectorError } from "@/connectors/errors";
import { db } from "@/db/client";
import {
  candidateProfiles,
  careerSources,
  companies,
  deadLetterRecords,
  globalCareerSources,
  globalOutboxEvents,
  globalScanRuns,
  globalScanSchedules,
  outboxEvents,
  rawObservations,
  scanRuns,
  scanSourceRuns,
  securityRateLimits,
  storageCleanupRecords,
  watchlists,
  workerAttempts,
} from "@/db/schema";
import { discoverBroadSources } from "@/lib/discovery/broad";
import { rolloutFlags } from "@/config/rollout";
import {
  deliverDeferredAlerts,
  deliverMorningDigest,
  queueExceptionalAlert,
} from "@/lib/notifications/orchestrate";
import { retryFailedNotifications } from "@/lib/notifications/slack";
import { deliverDueWebPush } from "@/lib/notifications/web-push";
import { processStorageCleanupRecords } from "@/lib/maintenance/storage-cleanup";
import {
  finalizeStagedSource,
  loadActiveSources,
  processStagedListing,
  stageStoredSource,
} from "@/lib/scans/scan-source";
import { recordSourceScanFailure } from "@/lib/scans/record-failure";
import { rebalanceColdCadence } from "@/lib/scans/adaptive-cadence";
import { loadGlobalSource, scanGlobalSource } from "@/lib/supply/global-source";
import {
  claimDueGlobalSources,
  loadPendingGlobalScans,
  markGlobalScansDispatched,
} from "@/lib/supply/global-scheduler";
import { attachGlobalSourcesToUser } from "@/lib/supply/user-overlay";
import { inngest } from "./client";

const sourceEventSchema = z.object({
  userId: z.string().uuid(),
  sourceId: z.string().uuid(),
  scheduledFor: z.string().datetime(),
  scanKind: z.enum(["watchlist", "broad_discovery", "closure"]).default("watchlist"),
});

const globalSourceEventSchema = z.object({
  sourceId: z.string().uuid(),
  scanRunId: z.string().uuid(),
  scheduledFor: z.string().datetime(),
});

const notificationUserEventSchema = z.object({
  userId: z.string().uuid(),
  scheduledFor: z.string().datetime(),
});

const attachGlobalSourcesEventSchema = z.object({
  userId: z.string().uuid(),
  sourceIds: z.array(z.string().uuid()).max(500),
  verifiedAt: z.string().datetime(),
});

export const globalSourceScheduler = inngest.createFunction(
  {
    id: "global-source-scheduler-v2",
    triggers: [{ cron: "*/5 * * * *" }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    if (!rolloutFlags().globalSupply) return { disabled: true };
    const claimed = await step.run("claim-oldest-due-global-sources", () =>
      claimDueGlobalSources(),
    );
    const pending = await step.run("load-pending-global-source-outbox", () =>
      loadPendingGlobalScans(),
    );
    if (pending.length) {
      await step.sendEvent(
        "dispatch-global-source-scans",
        pending.map((record) => ({
          id: record.id,
          name: record.eventName,
          data: globalSourceEventSchema.parse(record.payload),
        })),
      );
      await step.run("mark-global-source-outbox-dispatched", () =>
        markGlobalScansDispatched(pending.map((record) => record.id)),
      );
    }
    return { claimed, dispatched: pending.length };
  },
);

export const globalSourceScan = inngest.createFunction(
  {
    id: "global-source-scan-v2",
    triggers: [{ event: "supply/source.scan.requested.v2" }],
    retries: 4,
    concurrency: [{ limit: 1, key: "event.data.sourceId" }, { limit: 5 }],
    onFailure: async ({ event, error }) => {
      const parsed = globalSourceEventSchema.safeParse(event.data.event.data);
      if (!parsed.success) return;
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(globalScanRuns)
          .set({
            status: "failed",
            finishedAt: now,
            errorCode: error instanceof Error ? error.name.slice(0, 100) : "UNKNOWN",
            updatedAt: now,
          })
          .where(eq(globalScanRuns.id, parsed.data.scanRunId));
        await tx
          .update(globalCareerSources)
          .set({ lastAttemptAt: now, lastErrorCode: "GLOBAL_SCAN_FAILED", updatedAt: now })
          .where(eq(globalCareerSources.id, parsed.data.sourceId));
        await tx
          .update(globalScanSchedules)
          .set({ leasedUntil: null, leaseToken: null, updatedAt: now })
          .where(eq(globalScanSchedules.careerSourceId, parsed.data.sourceId));
      });
    },
  },
  async ({ event, step }) => {
    // Once dispatched, a scan finishes even if rollout is deactivated. The
    // disabled scheduler prevents new claims; completing in-flight work avoids
    // a stranded queued run and lease.
    const data = globalSourceEventSchema.parse(event.data);
    const source = await step.run("load-global-source", () => loadGlobalSource(data.sourceId));
    if (!source) throw new NonRetriableError("Active global source was not found");
    await step.run("mark-global-source-running", () =>
      db
        .update(globalScanRuns)
        .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
        .where(eq(globalScanRuns.id, data.scanRunId)),
    );
    const result = await step.run("scan-global-source-once", async () => {
      try {
        return await scanGlobalSource(source, new Date(data.scheduledFor), data.scanRunId);
      } catch (error) {
        if (error instanceof ConnectorError && !error.retryable)
          throw new NonRetriableError(`[${error.code}] ${error.message}`, { cause: error });
        throw error;
      }
    });
    await step.run("complete-global-source-run", async () => {
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(globalScanRuns)
          .set({
            status: "succeeded",
            finishedAt: now,
            complete: true,
            metrics: result,
            updatedAt: now,
          })
          .where(eq(globalScanRuns.id, data.scanRunId));
        await tx
          .update(globalScanSchedules)
          .set({ leasedUntil: null, leaseToken: null, updatedAt: now })
          .where(eq(globalScanSchedules.careerSourceId, data.sourceId));
      });
    });
    return result;
  },
);

export const watchlistScheduler = inngest.createFunction(
  { id: "watchlist-scheduler", triggers: [{ cron: "*/15 * * * *" }] },
  async ({ step }) => {
    if (rolloutFlags().globalSupply) return { disabled: true };
    const due = await step.run("lease-due-watchlists", async () => {
      await rebalanceColdCadence();
      const now = new Date();
      const rows = await db
        .select()
        .from(watchlists)
        .where(and(eq(watchlists.active, true), lte(watchlists.nextScanAt, now)))
        .orderBy(
          asc(watchlists.nextScanAt),
          sql`case ${watchlists.monitoringTier} when 'priority' then 0 when 'standard' then 1 when 'warm' then 2 when 'cold' then 3 else 4 end`,
          asc(watchlists.id),
        )
        .limit(100);
      let claimed = 0;
      let enqueued = 0;
      for (const row of rows) {
        const result = await db.transaction(async (tx) => {
          const [leased] = await tx
            .update(watchlists)
            .set({
              nextScanAt: new Date(now.getTime() + row.cadenceMinutes * 60_000),
              updatedAt: now,
            })
            .where(and(eq(watchlists.id, row.id), lte(watchlists.nextScanAt, now)))
            .returning({ companyId: watchlists.companyId });
          if (!leased) return { claimed: 0, enqueued: 0 };
          const sources = await tx
            .select({ id: careerSources.id })
            .from(careerSources)
            .innerJoin(companies, eq(careerSources.companyId, companies.id))
            .where(
              and(
                eq(careerSources.userId, row.userId),
                eq(careerSources.companyId, leased.companyId),
                eq(careerSources.active, true),
                eq(companies.active, true),
              ),
            );
          if (sources.length)
            await tx
              .insert(outboxEvents)
              .values(
                sources.map((source) => ({
                  userId: row.userId,
                  eventName: "firstseen/source.scan.requested",
                  aggregateType: "career_source",
                  aggregateId: source.id,
                  idempotencyKey: `watchlist:${row.id}:${row.nextScanAt.toISOString()}:${source.id}`,
                  payload: {
                    userId: row.userId,
                    sourceId: source.id,
                    scheduledFor: now.toISOString(),
                    scanKind: "watchlist" as const,
                  },
                })),
              )
              .onConflictDoNothing();
          return { claimed: 1, enqueued: sources.length };
        });
        claimed += result.claimed;
        enqueued += result.enqueued;
      }
      return { claimed, enqueued };
    });
    const pending = await step.run("load-pending-source-outbox", () =>
      db
        .select({
          id: outboxEvents.id,
          eventName: outboxEvents.eventName,
          payload: outboxEvents.payload,
        })
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.status, "pending"),
            lte(outboxEvents.availableAt, new Date()),
            eq(outboxEvents.eventName, "firstseen/source.scan.requested"),
          ),
        )
        .orderBy(asc(outboxEvents.availableAt), asc(outboxEvents.id))
        .limit(500),
    );
    if (pending.length) {
      await step.sendEvent(
        "dispatch-source-scans",
        pending.map((record) => ({
          id: record.id,
          name: "firstseen/source.scan.requested" as const,
          data: sourceEventSchema.parse(record.payload),
        })),
      );
      await step.run("mark-source-outbox-dispatched", () =>
        db
          .update(outboxEvents)
          .set({ status: "dispatched", dispatchedAt: new Date(), updatedAt: new Date() })
          .where(
            inArray(
              outboxEvents.id,
              pending.map((record) => record.id),
            ),
          ),
      );
    }
    return { ...due, dispatched: pending.length };
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
      db
        .select({ userId: candidateProfiles.userId })
        .from(candidateProfiles)
        .orderBy(asc(candidateProfiles.userId)),
    );
    if (!users.length) return { disabled: false, reason: "no_candidate_profiles" };
    const scheduledFor = new Date().toISOString();
    const discoveryOwner = users[0]!;
    const discovered = await step.run("discover-global-sources-once", () =>
      discoverBroadSources(discoveryOwner.userId),
    );
    if (discovered.globalSourceIds.length && rolloutFlags().globalSupply)
      await step.sendEvent(
        "fan-out-global-source-overlays",
        users.map((user) => ({
          id: `source-overlay:${user.userId}:${scheduledFor}`,
          name: "supply/user.sources.attach.requested.v2" as const,
          data: {
            userId: user.userId,
            sourceIds: discovered.globalSourceIds,
            verifiedAt: scheduledFor,
          },
        })),
      );
    if (discovered.sourceIds.length && !rolloutFlags().globalSupply)
      await step.sendEvent(
        `verify-${discoveryOwner.userId}`,
        discovered.sourceIds.map((sourceId) => ({
          name: "firstseen/source.scan.requested" as const,
          data: {
            userId: discoveryOwner.userId,
            sourceId,
            scheduledFor,
            scanKind: "broad_discovery" as const,
          },
        })),
      );
    return {
      ...discovered,
      sensorPasses: 1,
      users: users.length,
      overlayEvents: rolloutFlags().globalSupply ? users.length : 0,
      dispatchedLegacy: rolloutFlags().globalSupply ? 0 : discovered.sourceIds.length,
      scheduledGlobally: rolloutFlags().globalSupply ? discovered.globalSourceIds.length : 0,
    };
  },
);

export const attachGlobalSourceOverlays = inngest.createFunction(
  {
    id: "attach-global-source-overlays-v2",
    triggers: [{ event: "supply/user.sources.attach.requested.v2" }],
    retries: 4,
    concurrency: [{ limit: 1, key: "event.data.userId" }, { limit: 10 }],
  },
  async ({ event, step }) => {
    const data = attachGlobalSourcesEventSchema.parse(event.data);
    const attached = await step.run("attach-verified-global-sources", () =>
      attachGlobalSourcesToUser(data.userId, data.sourceIds, new Date(data.verifiedAt)),
    );
    return { userId: data.userId, requested: data.sourceIds.length, attached: attached.length };
  },
);

export const notificationSchedule = inngest.createFunction(
  { id: "notification-schedule", triggers: [{ cron: "0 * * * *" }], retries: 3 },
  async ({ step }) => {
    const users = await step.run("load-users", () =>
      db.select({ userId: candidateProfiles.userId }).from(candidateProfiles),
    );
    const scheduledFor = new Date().toISOString();
    if (users.length)
      await step.sendEvent(
        "fan-out-user-notifications",
        users.map((user) => ({
          id: `notification:${user.userId}:${scheduledFor}`,
          name: "firstseen/user.notifications.requested" as const,
          data: { userId: user.userId, scheduledFor },
        })),
      );
    return { dispatched: users.length, scheduledFor };
  },
);

export const userNotificationDelivery = inngest.createFunction(
  {
    id: "user-notification-delivery",
    triggers: [{ event: "firstseen/user.notifications.requested" }],
    retries: 3,
    concurrency: [{ limit: 1, key: "event.data.userId" }, { limit: 10 }],
  },
  async ({ event, step }) => {
    const data = notificationUserEventSchema.parse(event.data);
    const digest = await step.run("morning-digest", () => deliverMorningDigest(data.userId));
    const deferred = await step.run("deferred-alerts", () => deliverDeferredAlerts(data.userId));
    const slackRetries = await step.run("failed-slack-retries", () =>
      retryFailedNotifications(data.userId),
    );
    const push = rolloutFlags().webPush
      ? await step.run("due-web-push", () => deliverDueWebPush(data.userId))
      : { disabled: true };
    return {
      userId: data.userId,
      scheduledFor: data.scheduledFor,
      digest,
      deferred,
      slackRetries,
      push,
    };
  },
);

export const cleanupSchedule = inngest.createFunction(
  { id: "retention-cleanup", triggers: [{ cron: "43 3 * * *" }], retries: 2 },
  async ({ step }) => {
    const privateStorage = await step.run("cleanup-private-storage", () =>
      processStorageCleanupRecords(),
    );
    return step.run("cleanup-expired-records", async () => {
      const observations = await db
        .delete(rawObservations)
        .where(lte(rawObservations.expiresAt, new Date()))
        .returning({ id: rawObservations.id });
      const rateLimits = await db
        .delete(securityRateLimits)
        .where(lt(securityRateLimits.windowStartedAt, new Date(Date.now() - 7 * 86_400_000)))
        .returning({ keyHash: securityRateLimits.keyHash });
      const globalOutbox = await db
        .delete(globalOutboxEvents)
        .where(
          and(
            eq(globalOutboxEvents.status, "dispatched"),
            lt(globalOutboxEvents.dispatchedAt, new Date(Date.now() - 30 * 86_400_000)),
          ),
        )
        .returning({ id: globalOutboxEvents.id });
      const storageOutbox = await db
        .delete(storageCleanupRecords)
        .where(
          and(
            eq(storageCleanupRecords.status, "cleaned"),
            lt(storageCleanupRecords.cleanedAt, new Date(Date.now() - 30 * 86_400_000)),
          ),
        )
        .returning({ id: storageCleanupRecords.id });
      return {
        privateStorage,
        observationsDeleted: observations.length,
        rateLimitsDeleted: rateLimits.length,
        globalOutboxDeleted: globalOutbox.length,
        storageOutboxDeleted: storageOutbox.length,
      };
    });
  },
);

export const functions = [
  globalSourceScheduler,
  globalSourceScan,
  watchlistScheduler,
  sourceScan,
  broadDiscovery,
  attachGlobalSourceOverlays,
  notificationSchedule,
  userNotificationDelivery,
  cleanupSchedule,
];
