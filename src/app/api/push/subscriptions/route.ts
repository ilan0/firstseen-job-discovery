import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";
import { currentOwner } from "@/lib/auth/owner";
import { serverEnv } from "@/lib/env/server";
import {
  assertSupportedPushEndpoint,
  pushCapabilitySchema,
  pushEndpointHash,
} from "@/lib/notifications/push-capability";
import { encryptCapability } from "@/lib/security/encrypted-capability";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { hasTrustedMutationOrigin } from "@/lib/security/request-origin";
import { rolloutFlags } from "@/config/rollout";
import { ensureWebPushChannel } from "@/lib/notifications/preferences";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function untrusted() {
  return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
}

async function enforceMutationRateLimit(userId: string) {
  const limit = await consumeRateLimit({
    namespace: "push_subscription_mutation",
    identifier: userId,
    maximum: 30,
    windowMinutes: 10,
    blockMinutes: 10,
  });
  return limit.allowed
    ? null
    : NextResponse.json(
        { error: "Too many push-setting changes" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
}

function safeDeviceLabel(userAgent: string | null) {
  if (!userAgent) return "Browser device";
  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/iPad/i.test(userAgent)) return "iPad";
  if (/Android/i.test(userAgent)) return "Android device";
  if (/Macintosh/i.test(userAgent)) return "Mac";
  if (/Windows/i.test(userAgent)) return "Windows device";
  return "Browser device";
}

export async function POST(request: Request) {
  if (!rolloutFlags().webPush) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  const env = serverEnv();
  if (!hasTrustedMutationOrigin(request, env.NEXT_PUBLIC_APP_URL)) return untrusted();
  const limited = await enforceMutationRateLimit(owner.id);
  if (limited) return limited;
  if (!env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY)
    return NextResponse.json({ error: "Push is not configured" }, { status: 503 });
  const parsed = pushCapabilitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  let endpoint: string;
  try {
    endpoint = assertSupportedPushEndpoint(parsed.data.endpoint);
  } catch {
    return NextResponse.json({ error: "Unsupported push provider" }, { status: 400 });
  }
  const endpointHash = pushEndpointHash(endpoint);
  const [existing] = await db
    .select({
      id: pushSubscriptions.id,
      userId: pushSubscriptions.userId,
      detailedLockScreen: pushSubscriptions.detailedLockScreen,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpointHash, endpointHash))
    .limit(1);
  if (existing && existing.userId !== owner.id) return untrusted();
  const channelId = (await ensureWebPushChannel(owner.id)).id;
  const encryptedCapability = encryptCapability(
    { ...parsed.data, endpoint },
    env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY,
  );
  const expirationTime = parsed.data.expirationTime ? new Date(parsed.data.expirationTime) : null;
  let subscriptionId = existing?.id ?? null;
  let detailedLockScreen = existing?.detailedLockScreen ?? false;
  if (existing)
    await db
      .update(pushSubscriptions)
      .set({
        channelId,
        encryptedCapability,
        expirationTime,
        revokedAt: null,
        failureCount: 0,
        userAgentSafe: request.headers.get("user-agent")?.slice(0, 160) ?? null,
        deviceLabel: safeDeviceLabel(request.headers.get("user-agent")),
        updatedAt: new Date(),
      })
      .where(and(eq(pushSubscriptions.userId, owner.id), eq(pushSubscriptions.id, existing.id)));
  else {
    const [inserted] = await db
      .insert(pushSubscriptions)
      .values({
        userId: owner.id,
        channelId,
        endpointHash,
        encryptedCapability,
        expirationTime,
        userAgentSafe: request.headers.get("user-agent")?.slice(0, 160) ?? null,
        deviceLabel: safeDeviceLabel(request.headers.get("user-agent")),
      })
      .onConflictDoNothing()
      .returning({ id: pushSubscriptions.id });
    subscriptionId = inserted?.id ?? null;
    if (!inserted) {
      const [raced] = await db
        .select({
          id: pushSubscriptions.id,
          userId: pushSubscriptions.userId,
          detailedLockScreen: pushSubscriptions.detailedLockScreen,
        })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpointHash, endpointHash))
        .limit(1);
      if (!raced || raced.userId !== owner.id) return untrusted();
      subscriptionId = raced.id;
      detailedLockScreen = raced.detailedLockScreen;
      await db
        .update(pushSubscriptions)
        .set({
          channelId,
          encryptedCapability,
          expirationTime,
          revokedAt: null,
          failureCount: 0,
          userAgentSafe: request.headers.get("user-agent")?.slice(0, 160) ?? null,
          deviceLabel: safeDeviceLabel(request.headers.get("user-agent")),
          updatedAt: new Date(),
        })
        .where(and(eq(pushSubscriptions.userId, owner.id), eq(pushSubscriptions.id, raced.id)));
    }
  }
  return NextResponse.json(
    { ok: true, subscriptionId, detailedLockScreen },
    { status: existing ? 200 : 201 },
  );
}

const deleteSchema = z.union([
  z.object({ endpoint: z.url({ protocol: /^https$/ }).max(2_000) }),
  z.object({ subscriptionId: z.string().uuid() }),
]);

export async function DELETE(request: Request) {
  if (!rolloutFlags().webPush) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  const env = serverEnv();
  if (!hasTrustedMutationOrigin(request, env.NEXT_PUBLIC_APP_URL)) return untrusted();
  const limited = await enforceMutationRateLimit(owner.id);
  if (limited) return limited;
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  await db
    .update(pushSubscriptions)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(pushSubscriptions.userId, owner.id),
        "endpoint" in parsed.data
          ? eq(pushSubscriptions.endpointHash, pushEndpointHash(parsed.data.endpoint))
          : eq(pushSubscriptions.id, parsed.data.subscriptionId),
      ),
    );
  return NextResponse.json({ ok: true });
}

const preferenceSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2_000),
  detailedLockScreen: z.boolean(),
});

export async function PATCH(request: Request) {
  if (!rolloutFlags().webPush) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  const env = serverEnv();
  if (!hasTrustedMutationOrigin(request, env.NEXT_PUBLIC_APP_URL)) return untrusted();
  const limited = await enforceMutationRateLimit(owner.id);
  if (limited) return limited;
  const parsed = preferenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid preference" }, { status: 400 });
  const endpointHash = pushEndpointHash(parsed.data.endpoint);
  const [updated] = await db
    .update(pushSubscriptions)
    .set({ detailedLockScreen: parsed.data.detailedLockScreen, updatedAt: new Date() })
    .where(
      and(
        eq(pushSubscriptions.userId, owner.id),
        eq(pushSubscriptions.endpointHash, endpointHash),
        isNull(pushSubscriptions.revokedAt),
      ),
    )
    .returning({ id: pushSubscriptions.id });
  if (!updated) return NextResponse.json({ error: "Push device not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
