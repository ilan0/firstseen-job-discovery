// @vitest-environment node

import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

dotenv.config({ path: ".env.local", quiet: true });
vi.mock("server-only", () => ({}));

const enabled = process.env.RUN_DATABASE_TESTS === "true";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY ?? "", {
  auth: { autoRefreshToken: false, persistSession: false },
});
const browser = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
  auth: { autoRefreshToken: false, persistSession: false },
});

describe.runIf(enabled)("durable private-storage cleanup", () => {
  const suffix = randomUUID();
  const bucket = `cleanup-${suffix}`;
  const successPath = `${suffix}/success.pdf`;
  const retryPath = `${suffix}/retry.pdf`;
  const ids: string[] = [];

  beforeAll(async () => {
    const inserted = await admin
      .from("storage_cleanup_records")
      .insert([
        {
          bucket,
          object_path: successPath,
          reason: "integration_test",
          status: "pending",
          next_attempt_at: "2026-08-04T12:00:00Z",
        },
        {
          bucket,
          object_path: retryPath,
          reason: "integration_test",
          status: "pending",
          next_attempt_at: "2026-08-04T12:00:00Z",
        },
      ])
      .select("id");
    if (inserted.error) throw inserted.error;
    ids.push(...(inserted.data ?? []).map((record) => record.id));
  });

  afterAll(async () => {
    if (ids.length) await admin.from("storage_cleanup_records").delete().in("id", ids);
  });

  it("isolates failures, retries idempotently, and denies browser access", async () => {
    const { processStorageCleanupRecords } = await import("@/lib/maintenance/storage-cleanup");
    const firstRemover = vi.fn(async (_bucket: string, objectPath: string) => {
      if (objectPath === retryPath) throw new TypeError("temporary provider failure");
    });
    expect(
      await processStorageCleanupRecords({
        ids,
        now: new Date("2026-08-04T13:00:00Z"),
        remover: firstRemover,
      }),
    ).toEqual({ due: 2, cleaned: 1, failed: 1 });
    const first = await admin
      .from("storage_cleanup_records")
      .select("object_path,status,attempt_count,last_error_code")
      .in("id", ids);
    expect(first.error).toBeNull();
    expect(first.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ object_path: successPath, status: "cleaned", attempt_count: 1 }),
        expect.objectContaining({
          object_path: retryPath,
          status: "failed",
          attempt_count: 1,
          last_error_code: "TYPEERROR",
        }),
      ]),
    );

    const retryRemover = vi.fn(async () => undefined);
    expect(
      await processStorageCleanupRecords({
        ids,
        now: new Date("2026-08-04T13:16:00Z"),
        remover: retryRemover,
      }),
    ).toEqual({ due: 1, cleaned: 1, failed: 0 });
    expect(retryRemover).toHaveBeenCalledOnce();

    const denied = await browser.from("storage_cleanup_records").select("id");
    expect(denied.data).toBeNull();
    expect(denied.error?.code).toBe("42501");
  });
});
