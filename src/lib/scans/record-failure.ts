import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  careerSources,
  companies,
  deadLetterRecords,
  scanRuns,
  scanSourceRuns,
  watchlists,
  workerAttempts,
} from "@/db/schema";

export function sourceFailureCode(error: unknown) {
  let current = error;
  let explicit: unknown = null;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    if ("code" in current && typeof (current as { code?: unknown }).code === "string") {
      explicit = (current as { code: string }).code;
      break;
    }
    current = "cause" in current ? (current as { cause?: unknown }).cause : null;
  }
  if (explicit === null && error instanceof Error) {
    explicit = error.message.match(/^\[([A-Z0-9_]{1,80})\]/)?.[1] ?? null;
  }
  const candidate =
    typeof explicit === "string" && explicit.length > 0
      ? explicit
      : error instanceof Error
        ? error.name
        : "ERROR";
  return candidate
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .slice(0, 80);
}

export async function recordSourceScanFailure(options: {
  userId: string;
  sourceId: string;
  idempotencyKey: string;
  failureEventId: string;
  originalEventId?: string | null | undefined;
  eventPayload: Record<string, unknown>;
  error: unknown;
  now?: Date;
}) {
  const now = options.now ?? new Date();
  const errorCode = sourceFailureCode(options.error);
  const quarantineSource = ["CONNECTOR_PAGINATION_LIMIT", "RESPONSE_TOO_LARGE"].includes(errorCode);

  await db.transaction(async (tx) => {
    await tx
      .insert(deadLetterRecords)
      .values({
        userId: options.userId,
        workflowName: "source-scan",
        eventId: options.failureEventId,
        eventName: "firstseen/source.scan.requested",
        eventPayload: options.eventPayload,
        errorCode,
        errorMessageSafe: "Source scan exhausted its durable retries.",
        failedAt: now,
      })
      .onConflictDoNothing();

    const [run] = await tx
      .select({ id: scanRuns.id })
      .from(scanRuns)
      .where(eq(scanRuns.idempotencyKey, options.idempotencyKey))
      .limit(1);
    if (run) {
      await tx
        .update(scanSourceRuns)
        .set({
          status: "failed",
          finishedAt: now,
          errorCode,
          errorMessageSafe: "The source scan failed after durable retries.",
          updatedAt: now,
        })
        .where(
          and(
            eq(scanSourceRuns.scanRunId, run.id),
            eq(scanSourceRuns.careerSourceId, options.sourceId),
          ),
        );
    }
    await tx
      .update(scanRuns)
      .set({ status: "failed", finishedAt: now, failureCount: 1, updatedAt: now })
      .where(eq(scanRuns.idempotencyKey, options.idempotencyKey));
    await tx
      .update(workerAttempts)
      .set({
        status: "failed",
        finishedAt: now,
        errorCode,
        errorMessageSafe: "The source scan failed after durable retries.",
        updatedAt: now,
      })
      .where(
        and(
          eq(workerAttempts.eventId, options.originalEventId ?? options.idempotencyKey),
          eq(workerAttempts.stepName, "scan"),
        ),
      );
    const [source] = await tx
      .select({ companyId: careerSources.companyId })
      .from(careerSources)
      .where(and(eq(careerSources.userId, options.userId), eq(careerSources.id, options.sourceId)))
      .limit(1);
    await tx
      .update(careerSources)
      .set({
        lastAttemptAt: now,
        lastErrorCode: errorCode,
        ...(quarantineSource ? { active: false } : {}),
        updatedAt: now,
      })
      .where(and(eq(careerSources.userId, options.userId), eq(careerSources.id, options.sourceId)));
    if (quarantineSource && source) {
      await tx
        .update(watchlists)
        .set({ active: false, updatedAt: now })
        .where(
          and(eq(watchlists.userId, options.userId), eq(watchlists.companyId, source.companyId)),
        );
      await tx
        .update(companies)
        .set({ active: false, updatedAt: now })
        .where(
          and(
            eq(companies.userId, options.userId),
            eq(companies.id, source.companyId),
            eq(companies.provisional, true),
          ),
        );
    }
  });
}
