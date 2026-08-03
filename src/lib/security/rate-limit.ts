import "server-only";
import { createHmac } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { securityRateLimits } from "@/db/schema";
import { serverEnv } from "@/lib/env/server";

type RateLimitOptions = {
  namespace: string;
  identifier: string;
  maximum: number;
  windowMinutes: number;
  blockMinutes: number;
  now?: Date;
};

function rateLimitKey(namespace: string, identifier: string) {
  return createHmac("sha256", serverEnv().RATE_LIMIT_SALT)
    .update(`${namespace}\0${identifier}`)
    .digest("hex");
}

export async function consumeRateLimit(options: RateLimitOptions) {
  const now = options.now ?? new Date();
  const keyHash = rateLimitKey(options.namespace, options.identifier);
  const windowStart = new Date(now.getTime() - options.windowMinutes * 60_000);
  const blockedUntil = new Date(now.getTime() + options.blockMinutes * 60_000);
  const nowValue = now.toISOString();
  const windowStartValue = windowStart.toISOString();
  const blockedUntilValue = blockedUntil.toISOString();
  const result = await db.execute<{ request_count: number; blocked_until: string | null }>(sql`
    insert into security_rate_limits (
      key_hash, namespace, window_started_at, request_count, blocked_until, last_attempt_at
    ) values (${keyHash}, ${options.namespace}, ${nowValue}, 1, null, ${nowValue})
    on conflict (key_hash) do update set
      namespace = excluded.namespace,
      request_count = case
        when security_rate_limits.window_started_at < ${windowStartValue} then 1
        else security_rate_limits.request_count + 1
      end,
      window_started_at = case
        when security_rate_limits.window_started_at < ${windowStartValue} then ${nowValue}
        else security_rate_limits.window_started_at
      end,
      blocked_until = case
        when security_rate_limits.blocked_until > ${nowValue} then security_rate_limits.blocked_until
        when security_rate_limits.window_started_at >= ${windowStartValue}
          and security_rate_limits.request_count + 1 > ${options.maximum}
          then ${blockedUntilValue}
        else null
      end,
      last_attempt_at = ${nowValue}
    returning request_count, blocked_until
  `);
  const row = result[0];
  const activeBlock = row?.blocked_until && new Date(row.blocked_until).getTime() > now.getTime();
  return {
    allowed: !activeBlock && Number(row?.request_count ?? 1) <= options.maximum,
    retryAfterSeconds: activeBlock
      ? Math.max(1, Math.ceil((new Date(row!.blocked_until!).getTime() - now.getTime()) / 1_000))
      : 0,
  };
}

export async function clearRateLimit(options: Pick<RateLimitOptions, "namespace" | "identifier">) {
  await db
    .delete(securityRateLimits)
    .where(eq(securityRateLimits.keyHash, rateLimitKey(options.namespace, options.identifier)));
}
