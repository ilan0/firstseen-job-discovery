// @vitest-environment node

import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

dotenv.config({ path: ".env.local", quiet: true });
vi.mock("server-only", () => ({}));

const enabled = process.env.RUN_DATABASE_TESTS === "true";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SECRET_KEY ?? "",
  { auth: { autoRefreshToken: false, persistSession: false } },
);

describe.runIf(enabled)("source scan terminal failure persistence", () => {
  let userId = "";
  const sourceId = randomUUID();
  const scanRunId = randomUUID();
  const sourceRunId = randomUUID();
  const companyId = randomUUID();
  const originalEventId = randomUUID();
  const failureEventId = randomUUID();
  const scheduledFor = "2026-08-03T12:00:00.000Z";
  const idempotencyKey = `source:${sourceId}:${scheduledFor}`;

  beforeAll(async () => {
    const created = await admin.auth.admin.createUser({
      email: `source-failure-${randomUUID()}@firstseen.local`,
      password: `${randomUUID()}Aa9!`,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    userId = created.data.user.id;
    const { db } = await import("@/db/client");
    const { careerSources, companies, scanRuns, scanSourceRuns, watchlists, workerAttempts } =
      await import("@/db/schema");
    await db.insert(companies).values({
      id: companyId,
      userId,
      name: "Oversized provisional source",
      normalizedName: `oversized-${companyId}`,
      origin: "discovered",
      provisional: true,
    });
    await db.insert(careerSources).values({
      id: sourceId,
      userId,
      companyId,
      connectorKind: "ashby",
      baseUrl: "https://jobs.ashbyhq.com/oversized-test",
      normalizedUrl: `https://jobs.ashbyhq.com/oversized-test-${sourceId}`,
    });
    await db.insert(watchlists).values({ userId, companyId, cadenceMinutes: 240 });
    await db.insert(scanRuns).values({
      id: scanRunId,
      userId,
      kind: "broad_discovery",
      status: "running",
      trigger: "integration-test",
      idempotencyKey,
      scheduledFor: new Date(scheduledFor),
    });
    await db.insert(scanSourceRuns).values({
      id: sourceRunId,
      userId,
      scanRunId,
      careerSourceId: sourceId,
      status: "running",
    });
    await db.insert(workerAttempts).values({
      userId,
      workflowName: "source-scan",
      eventId: originalEventId,
      stepName: "scan",
      status: "running",
    });
  });

  afterAll(async () => {
    if (!userId) return;
    const { db } = await import("@/db/client");
    const { careerSources, companies, deadLetterRecords, scanRuns, watchlists, workerAttempts } =
      await import("@/db/schema");
    await db.delete(deadLetterRecords).where(eq(deadLetterRecords.userId, userId));
    await db.delete(workerAttempts).where(eq(workerAttempts.userId, userId));
    await db.delete(scanRuns).where(eq(scanRuns.userId, userId));
    await db.delete(watchlists).where(eq(watchlists.userId, userId));
    await db.delete(careerSources).where(eq(careerSources.userId, userId));
    await db.delete(companies).where(eq(companies.userId, userId));
    await admin.auth.admin.deleteUser(userId);
  });

  it("marks every operational record terminal and quarantines a rejected oversized source", async () => {
    const { db } = await import("@/db/client");
    const {
      careerSources,
      companies,
      deadLetterRecords,
      scanRuns,
      scanSourceRuns,
      watchlists,
      workerAttempts,
    } = await import("@/db/schema");
    const { recordSourceScanFailure } = await import("@/lib/scans/record-failure");
    const payload = { userId, sourceId, scheduledFor, scanKind: "broad_discovery" };
    await recordSourceScanFailure({
      userId,
      sourceId,
      idempotencyKey,
      failureEventId,
      originalEventId,
      eventPayload: payload,
      error: { name: "NonRetriableError", cause: { code: "RESPONSE_TOO_LARGE" } },
      now: new Date("2026-08-03T12:05:00.000Z"),
    });

    const [run] = await db.select().from(scanRuns).where(eq(scanRuns.id, scanRunId));
    const [sourceRun] = await db
      .select()
      .from(scanSourceRuns)
      .where(eq(scanSourceRuns.id, sourceRunId));
    const [worker] = await db
      .select()
      .from(workerAttempts)
      .where(eq(workerAttempts.eventId, originalEventId));
    const [deadLetter] = await db
      .select()
      .from(deadLetterRecords)
      .where(eq(deadLetterRecords.eventId, failureEventId));
    const [source] = await db.select().from(careerSources).where(eq(careerSources.id, sourceId));
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    const [watchlist] = await db
      .select()
      .from(watchlists)
      .where(eq(watchlists.companyId, companyId));

    expect(run).toMatchObject({ status: "failed", failureCount: 1 });
    expect(sourceRun).toMatchObject({ status: "failed", errorCode: "RESPONSE_TOO_LARGE" });
    expect(worker).toMatchObject({ status: "failed", errorCode: "RESPONSE_TOO_LARGE" });
    expect(deadLetter).toMatchObject({
      errorCode: "RESPONSE_TOO_LARGE",
      eventPayload: payload,
    });
    expect(source?.active).toBe(false);
    expect(company?.active).toBe(false);
    expect(watchlist).toMatchObject({ active: false, monitoringTier: "quarantined" });
  });
});
