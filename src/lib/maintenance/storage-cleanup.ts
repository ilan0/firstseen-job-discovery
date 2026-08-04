import "server-only";

import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { storageCleanupRecords } from "@/db/schema";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type StorageObjectRemover = (bucket: string, objectPath: string) => Promise<void>;

const defaultRemover: StorageObjectRemover = async (bucket, objectPath) => {
  const result = await createSupabaseAdminClient().storage.from(bucket).remove([objectPath]);
  if (result.error) throw new Error(result.error.name || "STORAGE_REMOVE_FAILED");
};

function safeErrorCode(error: unknown) {
  return error instanceof Error
    ? error.name
        .replace(/[^A-Za-z0-9_]/g, "_")
        .toUpperCase()
        .slice(0, 80) || "STORAGE_REMOVE_FAILED"
    : "STORAGE_REMOVE_FAILED";
}

export async function processStorageCleanupRecords(
  options: {
    ids?: string[];
    now?: Date;
    remover?: StorageObjectRemover;
    limit?: number;
  } = {},
) {
  const now = options.now ?? new Date();
  const remover = options.remover ?? defaultRemover;
  await db
    .update(storageCleanupRecords)
    .set({
      status: "failed",
      nextAttemptAt: now,
      lastErrorCode: "CLEANUP_LEASE_EXPIRED",
      updatedAt: now,
    })
    .where(
      and(
        eq(storageCleanupRecords.status, "processing"),
        lt(storageCleanupRecords.updatedAt, new Date(now.getTime() - 30 * 60_000)),
      ),
    );
  const rows = await db
    .select({ id: storageCleanupRecords.id })
    .from(storageCleanupRecords)
    .where(
      and(
        inArray(storageCleanupRecords.status, ["pending", "failed"]),
        lte(storageCleanupRecords.nextAttemptAt, now),
        ...(options.ids?.length ? [inArray(storageCleanupRecords.id, options.ids)] : []),
      ),
    )
    .orderBy(asc(storageCleanupRecords.nextAttemptAt), asc(storageCleanupRecords.id))
    .limit(options.limit ?? 100);
  let cleaned = 0;
  let failed = 0;
  for (const row of rows) {
    const [claimed] = await db
      .update(storageCleanupRecords)
      .set({
        status: "processing",
        attemptCount: sql`${storageCleanupRecords.attemptCount} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(storageCleanupRecords.id, row.id),
          inArray(storageCleanupRecords.status, ["pending", "failed"]),
          lte(storageCleanupRecords.nextAttemptAt, now),
        ),
      )
      .returning({
        id: storageCleanupRecords.id,
        bucket: storageCleanupRecords.bucket,
        objectPath: storageCleanupRecords.objectPath,
        attemptCount: storageCleanupRecords.attemptCount,
      });
    if (!claimed) continue;
    try {
      await remover(claimed.bucket, claimed.objectPath);
      await db
        .update(storageCleanupRecords)
        .set({
          status: "cleaned",
          cleanedAt: new Date(),
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(eq(storageCleanupRecords.id, claimed.id));
      cleaned += 1;
    } catch (error) {
      const backoffMinutes = Math.min(24 * 60, 15 * 2 ** Math.max(0, claimed.attemptCount - 1));
      await db
        .update(storageCleanupRecords)
        .set({
          status: "failed",
          nextAttemptAt: new Date(now.getTime() + backoffMinutes * 60_000),
          lastErrorCode: safeErrorCode(error),
          updatedAt: new Date(),
        })
        .where(eq(storageCleanupRecords.id, claimed.id));
      failed += 1;
    }
  }
  return { due: rows.length, cleaned, failed };
}
