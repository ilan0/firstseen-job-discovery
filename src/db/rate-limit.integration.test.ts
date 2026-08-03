// @vitest-environment node
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

dotenv.config({ path: ".env.local", quiet: true });
vi.mock("server-only", () => ({}));

const enabled = process.env.RUN_DATABASE_TESTS === "true";
const namespace = `rate-limit-test-${randomUUID()}`;

describe.runIf(enabled)("durable security rate limits", () => {
  afterAll(async () => {
    const { db } = await import("@/db/client");
    const { securityRateLimits } = await import("@/db/schema");
    await db.delete(securityRateLimits).where(eq(securityRateLimits.namespace, namespace));
  });

  it("atomically blocks excess attempts and resets after the window", async () => {
    const { clearRateLimit, consumeRateLimit } = await import("@/lib/security/rate-limit");
    const start = new Date("2026-08-03T12:00:00Z");
    const options = {
      namespace,
      identifier: "private-identifier",
      maximum: 2,
      windowMinutes: 15,
      blockMinutes: 15,
      now: start,
    };

    await expect(consumeRateLimit(options)).resolves.toMatchObject({ allowed: true });
    await expect(consumeRateLimit(options)).resolves.toMatchObject({ allowed: true });
    await expect(consumeRateLimit(options)).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: 900,
    });
    await expect(
      consumeRateLimit({ ...options, now: new Date(start.getTime() + 16 * 60_000) }),
    ).resolves.toMatchObject({ allowed: true, retryAfterSeconds: 0 });
    await clearRateLimit(options);
    await expect(consumeRateLimit(options)).resolves.toMatchObject({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });
});
