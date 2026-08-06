// @vitest-environment node
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

dotenv.config({ path: ".env.local", quiet: true });
vi.mock("server-only", () => ({}));

const enabled = process.env.RUN_DATABASE_TESTS === "true";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SECRET_KEY ?? "",
  { auth: { autoRefreshToken: false, persistSession: false } },
);

describe.runIf(enabled)("Web Push delivery persistence", () => {
  let user: User;
  let channelId: string;
  let logicalNotificationId: string;

  beforeAll(async () => {
    const created = await admin.auth.admin.createUser({
      email: `push-${randomUUID()}@firstseen.local`,
      password: `${randomUUID()}Aa9!`,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    user = created.data.user;
    const channel = await admin
      .from("notification_channels")
      .insert({ user_id: user.id, kind: "web_push", label: "Browser push" })
      .select("id")
      .single();
    if (channel.error) throw channel.error;
    channelId = channel.data.id;
    const notification = await admin
      .from("notifications")
      .insert({
        user_id: user.id,
        kind: "exceptional_match",
        status: "pending",
        idempotency_key: `push-test-${randomUUID()}`,
        payload_hash: randomUUID(),
        payload: {},
      })
      .select("id")
      .single();
    if (notification.error) throw notification.error;
    logicalNotificationId = notification.data.id;
  });

  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
  });

  async function fixture(
    suffix: string,
    attemptCount = 0,
    deliveryState: { status?: "pending" | "sending"; updatedAt?: Date } = {},
  ) {
    const { encryptCapability } = await import("@/lib/security/encrypted-capability");
    const endpoint = `https://fcm.googleapis.com/fcm/send/${suffix}`;
    const subscription = await admin
      .from("push_subscriptions")
      .insert({
        user_id: user.id,
        channel_id: channelId,
        endpoint_hash: randomUUID(),
        encrypted_capability: encryptCapability(
          {
            endpoint,
            expirationTime: null,
            keys: { p256dh: "A".repeat(44), auth: "B".repeat(22) },
          },
          process.env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY ?? "",
        ),
      })
      .select("id")
      .single();
    if (subscription.error) throw subscription.error;
    const delivery = await admin
      .from("notification_deliveries")
      .insert({
        user_id: user.id,
        logical_notification_id: logicalNotificationId,
        channel_id: channelId,
        push_subscription_id: subscription.data.id,
        reason: "test",
        policy_version: "test",
        idempotency_key: randomUUID(),
        status: deliveryState.status ?? "pending",
        attempt_count: attemptCount,
        next_attempt_at: new Date(0).toISOString(),
        updated_at: deliveryState.updatedAt?.toISOString(),
        provider_response_safe: { payload: { path: "/jobs/test" } },
      })
      .select("id")
      .single();
    if (delivery.error) throw delivery.error;
    return { subscriptionId: subscription.data.id, deliveryId: delivery.data.id };
  }

  async function subscription(suffix: string, detailedLockScreen: boolean) {
    const { encryptCapability } = await import("@/lib/security/encrypted-capability");
    const created = await admin
      .from("push_subscriptions")
      .insert({
        user_id: user.id,
        channel_id: channelId,
        endpoint_hash: randomUUID(),
        encrypted_capability: encryptCapability(
          {
            endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`,
            expirationTime: null,
            keys: { p256dh: "A".repeat(44), auth: "B".repeat(22) },
          },
          process.env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY ?? "",
        ),
        detailed_lock_screen: detailedLockScreen,
      })
      .select("id")
      .single();
    if (created.error) throw created.error;
    return created.data.id;
  }

  async function logicalJobAlert() {
    const created = await admin
      .from("notifications")
      .insert({
        user_id: user.id,
        kind: "job_alert",
        status: "pending",
        idempotency_key: `job-alert-test-${randomUUID()}`,
        payload_hash: randomUUID(),
        payload: {},
      })
      .select("id")
      .single();
    if (created.error) throw created.error;
    return created.data.id;
  }

  it("marks an accepted device delivery exactly once", async () => {
    const row = await fixture("accepted");
    const { deliverWebPush } = await import("@/lib/notifications/web-push");
    const sender = vi.fn(async () => ({ statusCode: 201, headers: {}, body: "" }));
    expect(await deliverWebPush(row.deliveryId, sender)).toMatchObject({ state: "delivered" });
    expect(await deliverWebPush(row.deliveryId, sender)).toMatchObject({
      state: "already_claimed",
    });
    expect(sender).toHaveBeenCalledTimes(1);
    const [stored, logical, channel] = await Promise.all([
      admin
        .from("notification_deliveries")
        .select("status,attempt_count")
        .eq("id", row.deliveryId)
        .single(),
      admin
        .from("notifications")
        .select("status,delivered_at")
        .eq("id", logicalNotificationId)
        .single(),
      admin.from("notification_channels").select("last_success_at").eq("id", channelId).single(),
    ]);
    expect(stored.data).toMatchObject({ status: "delivered", attempt_count: 1 });
    expect(logical.data).toMatchObject({ status: "delivered" });
    expect(logical.data?.delivered_at).toBeTruthy();
    expect(channel.data?.last_success_at).toBeTruthy();
  });

  it("uses per-device lock-screen privacy and stable delivery idempotency", async () => {
    const genericId = await subscription("generic-device", false);
    const detailedId = await subscription("detailed-device", true);
    const notificationId = await logicalJobAlert();
    const { queueWebPushDeliveries } = await import("@/lib/notifications/web-push");
    const options = {
      userId: user.id,
      logicalNotificationId: notificationId,
      reason: "possible",
      message: {
        path: "/jobs/example",
        tag: "firstseen-example",
        urgency: 88,
        detailedTitle: "Strong match · Example",
        detailedBody: "Software Engineer I",
      },
      notBefore: new Date(),
      subscriptionIds: [genericId, detailedId],
    };
    const deliveries = await queueWebPushDeliveries(options);
    expect(deliveries).toHaveLength(2);
    expect(await queueWebPushDeliveries(options)).toEqual([]);
    const stored = await admin
      .from("notification_deliveries")
      .select("push_subscription_id,provider_response_safe")
      .in("id", deliveries);
    expect(stored.error).toBeNull();
    const byDevice = new Map(
      stored.data?.map((row) => [row.push_subscription_id, row.provider_response_safe]) ?? [],
    );
    expect(byDevice.get(genericId)).toMatchObject({
      payload: { title: "New FirstSeen match", path: "/jobs/example" },
    });
    expect(byDevice.get(detailedId)).toMatchObject({
      payload: { title: "Strong match · Example", body: "Software Engineer I" },
    });
  });

  it("coalesces individually displayed alerts after the six-per-hour cap", async () => {
    const deviceId = await subscription("overflow-device", false);
    for (let index = 0; index < 6; index += 1) {
      const priorNotificationId = await logicalJobAlert();
      const prior = await admin.from("notification_deliveries").insert({
        user_id: user.id,
        logical_notification_id: priorNotificationId,
        channel_id: channelId,
        push_subscription_id: deviceId,
        reason: "hot",
        policy_version: "test",
        idempotency_key: randomUUID(),
        status: "delivered",
        next_attempt_at: new Date().toISOString(),
      });
      if (prior.error) throw prior.error;
    }
    const notificationId = await logicalJobAlert();
    const { queueWebPushDeliveries } = await import("@/lib/notifications/web-push");
    const [deliveryId] = await queueWebPushDeliveries({
      userId: user.id,
      logicalNotificationId: notificationId,
      reason: "strong",
      message: {
        path: "/jobs/overflow",
        tag: "firstseen-overflow-source",
        urgency: 95,
        detailedTitle: "Strong match · Overflow",
        detailedBody: "Software Engineer I",
      },
      notBefore: new Date(),
      subscriptionIds: [deviceId],
    });
    const stored = await admin
      .from("notification_deliveries")
      .select("reason,provider_response_safe")
      .eq("id", deliveryId)
      .single();
    expect(stored.data).toMatchObject({
      reason: "strong:overflow",
      provider_response_safe: {
        payload: { title: "More fresh FirstSeen matches", tag: "firstseen-fresh-overflow" },
      },
    });
  });

  it("revokes subscriptions after a 410 response", async () => {
    const row = await fixture("expired");
    const { deliverWebPush } = await import("@/lib/notifications/web-push");
    const sender = vi.fn(async () => {
      throw Object.assign(new Error("Gone"), { statusCode: 410 });
    });
    expect(await deliverWebPush(row.deliveryId, sender)).toMatchObject({ state: "expired" });
    const stored = await admin
      .from("push_subscriptions")
      .select("revoked_at")
      .eq("id", row.subscriptionId)
      .single();
    expect(stored.data?.revoked_at).toBeTruthy();
    const deadLetter = await admin
      .from("dead_letter_records")
      .select("id")
      .eq("event_id", `notification-push:${row.deliveryId}`)
      .maybeSingle();
    expect(deadLetter.data).toBeNull();
  });

  it("schedules a bounded retry after a temporary provider failure", async () => {
    const row = await fixture("temporary");
    const { deliverWebPush } = await import("@/lib/notifications/web-push");
    const sender = vi.fn(async () => {
      throw Object.assign(new Error("Unavailable"), { statusCode: 503 });
    });
    expect(await deliverWebPush(row.deliveryId, sender)).toMatchObject({
      state: "failed",
      retryable: true,
    });
    const stored = await admin
      .from("notification_deliveries")
      .select("status,next_attempt_at,last_error_code")
      .eq("id", row.deliveryId)
      .single();
    expect(stored.data).toMatchObject({ status: "failed", last_error_code: "PUSH_503" });
    expect(new Date(stored.data?.next_attempt_at ?? 0).getTime()).toBeGreaterThan(Date.now());
  });

  it("dead-letters a permanent provider rejection without retrying", async () => {
    const row = await fixture("permanent");
    const { deliverWebPush } = await import("@/lib/notifications/web-push");
    const sender = vi.fn(async () => {
      throw Object.assign(new Error("Bad request"), { statusCode: 400 });
    });
    await expect(deliverWebPush(row.deliveryId, sender)).resolves.toMatchObject({
      state: "failed",
      retryable: false,
    });
    const [delivery, deadLetter] = await Promise.all([
      admin
        .from("notification_deliveries")
        .select("next_attempt_at,last_error_code")
        .eq("id", row.deliveryId)
        .single(),
      admin
        .from("dead_letter_records")
        .select("error_code,resolved_at")
        .eq("event_id", `notification-push:${row.deliveryId}`)
        .single(),
    ]);
    expect(delivery.data).toMatchObject({ next_attempt_at: null, last_error_code: "PUSH_400" });
    expect(deadLetter.data).toMatchObject({ error_code: "PUSH_400", resolved_at: null });
  });

  it("revokes malformed encrypted capabilities without leaving work stuck", async () => {
    const row = await fixture("malformed");
    await admin
      .from("push_subscriptions")
      .update({ encrypted_capability: "not-an-encrypted-capability" })
      .eq("id", row.subscriptionId);
    const { deliverWebPush } = await import("@/lib/notifications/web-push");
    expect(await deliverWebPush(row.deliveryId, vi.fn())).toMatchObject({
      state: "invalid_capability",
    });
    const [delivery, subscription] = await Promise.all([
      admin
        .from("notification_deliveries")
        .select("status,last_error_code,next_attempt_at")
        .eq("id", row.deliveryId)
        .single(),
      admin.from("push_subscriptions").select("revoked_at").eq("id", row.subscriptionId).single(),
    ]);
    expect(delivery.data).toMatchObject({
      status: "failed",
      last_error_code: "PUSH_CAPABILITY_INVALID",
      next_attempt_at: null,
    });
    expect(subscription.data?.revoked_at).toBeTruthy();
  });

  it("dead-letters exhausted provider failures and resolves them after explicit replay", async () => {
    const row = await fixture("exhausted", 5);
    const { deliverWebPush } = await import("@/lib/notifications/web-push");
    const unavailable = vi.fn(async () => {
      throw Object.assign(new Error("Unavailable"), { statusCode: 503 });
    });
    await expect(deliverWebPush(row.deliveryId, unavailable)).resolves.toMatchObject({
      state: "failed",
      retryable: true,
    });
    const eventId = `notification-push:${row.deliveryId}`;
    const failed = await admin
      .from("dead_letter_records")
      .select("error_code,resolved_at,event_payload")
      .eq("event_id", eventId)
      .single();
    expect(failed.data).toMatchObject({
      error_code: "PUSH_RETRIES_EXHAUSTED",
      resolved_at: null,
      event_payload: { userId: user.id, channel: "web_push", deliveryId: row.deliveryId },
    });

    const { resetNotificationDeliveryForReplay } = await import("@/lib/notifications/dead-letter");
    await expect(
      resetNotificationDeliveryForReplay({
        userId: user.id,
        channel: "web_push",
        deliveryId: row.deliveryId,
      }),
    ).resolves.toBe(true);
    await expect(
      deliverWebPush(
        row.deliveryId,
        vi.fn(async () => ({ statusCode: 201, headers: {}, body: "" })),
      ),
    ).resolves.toMatchObject({ state: "delivered" });
    const resolved = await admin
      .from("dead_letter_records")
      .select("resolved_at")
      .eq("event_id", eventId)
      .single();
    expect(resolved.data?.resolved_at).toBeTruthy();
  });

  it("does not automatically redeliver a stale claim with an unknown provider outcome", async () => {
    const row = await fixture("stale", 1, { status: "sending", updatedAt: new Date(0) });
    const { deliverDueWebPush } = await import("@/lib/notifications/web-push");
    await expect(deliverDueWebPush(user.id, new Date())).resolves.toMatchObject({
      unknownOutcomes: 1,
    });
    const [delivery, deadLetter] = await Promise.all([
      admin
        .from("notification_deliveries")
        .select("status,next_attempt_at,last_error_code")
        .eq("id", row.deliveryId)
        .single(),
      admin
        .from("dead_letter_records")
        .select("error_code,resolved_at")
        .eq("event_id", `notification-push:${row.deliveryId}`)
        .single(),
    ]);
    expect(delivery.data).toMatchObject({
      status: "failed",
      next_attempt_at: null,
      last_error_code: "PUSH_DELIVERY_OUTCOME_UNKNOWN",
    });
    expect(deadLetter.data).toMatchObject({
      error_code: "PUSH_DELIVERY_OUTCOME_UNKNOWN",
      resolved_at: null,
    });
  });
});
