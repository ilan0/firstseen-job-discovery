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

  async function fixture(suffix: string) {
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
        status: "pending",
        next_attempt_at: new Date(0).toISOString(),
        provider_response_safe: { payload: { path: "/jobs/test" } },
      })
      .select("id")
      .single();
    if (delivery.error) throw delivery.error;
    return { subscriptionId: subscription.data.id, deliveryId: delivery.data.id };
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
    const stored = await admin
      .from("notification_deliveries")
      .select("status,attempt_count")
      .eq("id", row.deliveryId)
      .single();
    expect(stored.data).toMatchObject({ status: "delivered", attempt_count: 1 });
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
});
