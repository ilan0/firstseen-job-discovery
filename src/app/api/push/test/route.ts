import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { rolloutFlags } from "@/config/rollout";
import { db } from "@/db/client";
import { notifications, pushSubscriptions } from "@/db/schema";
import { currentOwner } from "@/lib/auth/owner";
import { serverEnv } from "@/lib/env/server";
import { pushEndpointHash } from "@/lib/notifications/push-capability";
import { payloadHash } from "@/lib/notifications/slack-payload";
import { deliverWebPush, queueWebPushDeliveries } from "@/lib/notifications/web-push";
import { PUSH_POLICY_VERSION } from "@/domain/notifications/policy";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { hasTrustedMutationOrigin } from "@/lib/security/request-origin";

const schema = z.object({ endpoint: z.url({ protocol: /^https$/ }).max(2_000) });

export async function POST(request: Request) {
  if (!rolloutFlags().webPush) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const owner = await currentOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasTrustedMutationOrigin(request, serverEnv().NEXT_PUBLIC_APP_URL))
    return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
  const limit = await consumeRateLimit({
    namespace: "push_test",
    identifier: owner.id,
    maximum: 5,
    windowMinutes: 10,
    blockMinutes: 10,
  });
  if (!limit.allowed)
    return NextResponse.json(
      { error: "Too many test notifications" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid Push device" }, { status: 400 });
  const [subscription] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, owner.id),
        eq(pushSubscriptions.endpointHash, pushEndpointHash(parsed.data.endpoint)),
        isNull(pushSubscriptions.revokedAt),
      ),
    )
    .limit(1);
  if (!subscription)
    return NextResponse.json({ error: "This device is not subscribed" }, { status: 404 });
  const testId = randomUUID();
  const payload = { test: true, label: "FirstSeen test notification", path: "/settings" };
  const [notification] = await db
    .insert(notifications)
    .values({
      userId: owner.id,
      kind: "test",
      status: "pending",
      idempotencyKey: `push-test:${testId}`,
      payloadHash: payloadHash(payload),
      payload,
      occurrenceId: testId,
      reasonCodes: ["user_requested_test"],
      policyVersion: PUSH_POLICY_VERSION,
      deferredUntil: new Date(),
    })
    .returning({ id: notifications.id });
  if (!notification)
    return NextResponse.json({ error: "Test could not be queued" }, { status: 500 });
  const [deliveryId] = await queueWebPushDeliveries({
    userId: owner.id,
    logicalNotificationId: notification.id,
    reason: "user_requested_test",
    message: {
      path: "/settings",
      tag: `firstseen-test-${testId}`,
      urgency: 100,
      detailedTitle: "FirstSeen test notification",
      detailedBody: "Push is working on this device.",
    },
    notBefore: new Date(),
    subscriptionIds: [subscription.id],
  });
  if (!deliveryId)
    return NextResponse.json({ error: "Test delivery could not be created" }, { status: 500 });
  const result = await deliverWebPush(deliveryId);
  if (result.state !== "delivered")
    return NextResponse.json(
      { error: "Push provider did not accept the test", state: result.state },
      { status: 502 },
    );
  return NextResponse.json({ ok: true, state: result.state });
}
