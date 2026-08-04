import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { notificationChannels, notificationPreferences, pushSubscriptions } from "@/db/schema";
import { currentOwner } from "@/lib/auth/owner";
import { serverEnv } from "@/lib/env/server";
import {
  assertSupportedPushEndpoint,
  pushCapabilitySchema,
  pushEndpointHash,
} from "@/lib/notifications/push-capability";
import { encryptCapability } from "@/lib/security/encrypted-capability";
import { hasTrustedMutationOrigin } from "@/lib/security/request-origin";
import { rolloutFlags } from "@/config/rollout";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function untrusted() {
  return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
}

async function webPushChannel(userId: string) {
  const [existing] = await db
    .select({ id: notificationChannels.id })
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.userId, userId),
        eq(notificationChannels.kind, "web_push"),
        eq(notificationChannels.label, "Browser push"),
      ),
    )
    .limit(1);
  const [channel] = existing
    ? [existing]
    : await db
        .insert(notificationChannels)
        .values({ userId, kind: "web_push", label: "Browser push", enabled: true })
        .returning({ id: notificationChannels.id });
  if (!channel) throw new Error("Push channel could not be configured.");
  const [preference] = await db
    .select({ id: notificationPreferences.id })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.channelId, channel.id),
        isNull(notificationPreferences.organizationId),
      ),
    )
    .limit(1);
  if (!preference)
    await db.insert(notificationPreferences).values({ userId, channelId: channel.id });
  return channel.id;
}

export async function POST(request: Request) {
  if (!rolloutFlags().webPush) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  const env = serverEnv();
  if (!hasTrustedMutationOrigin(request, env.NEXT_PUBLIC_APP_URL)) return untrusted();
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
    .select({ id: pushSubscriptions.id, userId: pushSubscriptions.userId })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpointHash, endpointHash))
    .limit(1);
  if (existing && existing.userId !== owner.id) return untrusted();
  const channelId = await webPushChannel(owner.id);
  const encryptedCapability = encryptCapability(
    { ...parsed.data, endpoint },
    env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY,
  );
  const expirationTime = parsed.data.expirationTime ? new Date(parsed.data.expirationTime) : null;
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
        updatedAt: new Date(),
      })
      .where(and(eq(pushSubscriptions.userId, owner.id), eq(pushSubscriptions.id, existing.id)));
  else
    await db.insert(pushSubscriptions).values({
      userId: owner.id,
      channelId,
      endpointHash,
      encryptedCapability,
      expirationTime,
      userAgentSafe: request.headers.get("user-agent")?.slice(0, 160) ?? null,
    });
  return NextResponse.json({ ok: true }, { status: existing ? 200 : 201 });
}

const deleteSchema = z.object({ endpoint: z.url({ protocol: /^https$/ }).max(2_000) });

export async function DELETE(request: Request) {
  if (!rolloutFlags().webPush) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  const env = serverEnv();
  if (!hasTrustedMutationOrigin(request, env.NEXT_PUBLIC_APP_URL)) return untrusted();
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  const endpointHash = pushEndpointHash(parsed.data.endpoint);
  await db
    .update(pushSubscriptions)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(pushSubscriptions.userId, owner.id), eq(pushSubscriptions.endpointHash, endpointHash)),
    );
  return NextResponse.json({ ok: true });
}

const preferenceSchema = z.object({ detailedLockScreen: z.boolean() });

export async function PATCH(request: Request) {
  if (!rolloutFlags().webPush) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const owner = await currentOwner();
  if (!owner) return unauthorized();
  const env = serverEnv();
  if (!hasTrustedMutationOrigin(request, env.NEXT_PUBLIC_APP_URL)) return untrusted();
  const parsed = preferenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid preference" }, { status: 400 });
  const [channel] = await db
    .select({ id: notificationChannels.id })
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.userId, owner.id),
        eq(notificationChannels.kind, "web_push"),
        eq(notificationChannels.label, "Browser push"),
      ),
    )
    .limit(1);
  if (!channel) return NextResponse.json({ error: "Push channel not found" }, { status: 404 });
  await db
    .update(notificationPreferences)
    .set({ detailedLockScreen: parsed.data.detailedLockScreen, updatedAt: new Date() })
    .where(
      and(
        eq(notificationPreferences.userId, owner.id),
        eq(notificationPreferences.channelId, channel.id),
        isNull(notificationPreferences.organizationId),
      ),
    );
  return NextResponse.json({ ok: true });
}
