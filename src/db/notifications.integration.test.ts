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

describe.runIf(enabled)("durable Slack notification delivery", () => {
  let user: User;
  let notificationId: string;

  beforeAll(async () => {
    const created = await admin.auth.admin.createUser({
      email: `notify-${randomUUID()}@firstseen.local`,
      password: `${randomUUID()}Aa9!`,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    user = created.data.user;
    const inserted = await admin
      .from("notifications")
      .insert({
        user_id: user.id,
        kind: "operational_alert",
        idempotency_key: `integration-${randomUUID()}`,
        payload_hash: "test-hash",
        payload: { text: "FirstSeen notification integration test" },
        deferred_until: new Date(0).toISOString(),
      })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;
    notificationId = inserted.data.id;
  });

  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
  });

  it("stores its payload, backs off after failure, and safely retries", async () => {
    const { deliverPendingNotification } = await import("@/lib/notifications/slack");
    const failedFetch: typeof fetch = vi.fn(async () => new Response("failure", { status: 500 }));
    await expect(
      deliverPendingNotification(notificationId, undefined, failedFetch),
    ).rejects.toThrow();

    const failed = await admin
      .from("notifications")
      .select("status,attempt_count,deferred_until")
      .eq("id", notificationId)
      .single();
    expect(failed.error).toBeNull();
    expect(failed.data?.status).toBe("failed");
    expect(failed.data?.attempt_count).toBe(1);
    expect(new Date(failed.data?.deferred_until ?? 0).getTime()).toBeGreaterThan(Date.now());

    await admin
      .from("notifications")
      .update({ deferred_until: new Date(0).toISOString() })
      .eq("id", notificationId);
    const successfulFetch: typeof fetch = vi.fn(async (_input, init) => {
      expect(String(init?.body)).toContain("notification integration test");
      return new Response("ok", { status: 200 });
    });
    await expect(
      deliverPendingNotification(notificationId, undefined, successfulFetch),
    ).resolves.toEqual({ state: "delivered" });

    const delivered = await admin
      .from("notifications")
      .select("status,attempt_count,delivered_at")
      .eq("id", notificationId)
      .single();
    expect(delivered.data?.status).toBe("delivered");
    expect(delivered.data?.attempt_count).toBe(2);
    expect(delivered.data?.delivered_at).toBeTruthy();
  });

  it("claims a due deferred alert only once under duplicate delivery", async () => {
    const deferred = await admin
      .from("notifications")
      .insert({
        user_id: user.id,
        kind: "exceptional_match",
        idempotency_key: `deferred-${randomUUID()}`,
        payload_hash: "deferred-test-hash",
        payload: { text: "Deferred integration test" },
        status: "deferred",
        deferred_until: new Date(0).toISOString(),
      })
      .select("id")
      .single();
    if (deferred.error) throw deferred.error;
    const deliver = vi.fn(async () => ({ state: "delivered" as const }));
    const { deliverDeferredAlerts } = await import("@/lib/notifications/orchestrate");

    await Promise.all([
      deliverDeferredAlerts(user.id, new Date(), deliver),
      deliverDeferredAlerts(user.id, new Date(), deliver),
    ]);

    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith(deferred.data.id);
  });

  it("dead-letters an exhausted Slack delivery and resolves it after explicit replay", async () => {
    const terminal = await admin
      .from("notifications")
      .insert({
        user_id: user.id,
        kind: "operational_alert",
        idempotency_key: `terminal-${randomUUID()}`,
        payload_hash: "terminal-test-hash",
        payload: { text: "Terminal Slack integration test" },
        status: "failed",
        attempt_count: 4,
        deferred_until: new Date(0).toISOString(),
      })
      .select("id")
      .single();
    if (terminal.error) throw terminal.error;
    const { deliverPendingNotification } = await import("@/lib/notifications/slack");
    const failedFetch: typeof fetch = vi.fn(async () => new Response("failure", { status: 503 }));
    await expect(
      deliverPendingNotification(terminal.data.id, undefined, failedFetch),
    ).rejects.toThrow();

    const eventId = `notification-slack:${terminal.data.id}`;
    const failed = await admin
      .from("dead_letter_records")
      .select("error_code,resolved_at,event_payload")
      .eq("event_id", eventId)
      .single();
    expect(failed.error).toBeNull();
    expect(failed.data).toMatchObject({
      error_code: "SLACK_RETRIES_EXHAUSTED",
      resolved_at: null,
      event_payload: { userId: user.id, channel: "slack", notificationId: terminal.data.id },
    });

    const { resetNotificationDeliveryForReplay } = await import("@/lib/notifications/dead-letter");
    await expect(
      resetNotificationDeliveryForReplay({
        userId: user.id,
        channel: "slack",
        notificationId: terminal.data.id,
      }),
    ).resolves.toBe(true);
    await expect(
      deliverPendingNotification(
        terminal.data.id,
        undefined,
        vi.fn(async () => new Response("ok", { status: 200 })),
      ),
    ).resolves.toEqual({ state: "delivered" });
    const resolved = await admin
      .from("dead_letter_records")
      .select("resolved_at")
      .eq("event_id", eventId)
      .single();
    expect(resolved.data?.resolved_at).toBeTruthy();
  });

  it("does not automatically redeliver a stale claim with an unknown provider outcome", async () => {
    const stale = await admin
      .from("notifications")
      .insert({
        user_id: user.id,
        kind: "operational_alert",
        idempotency_key: `stale-${randomUUID()}`,
        payload_hash: "stale-test-hash",
        payload: { text: "Stale Slack integration test" },
        status: "sending",
        attempt_count: 1,
        deferred_until: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      })
      .select("id")
      .single();
    if (stale.error) throw stale.error;
    const { retryFailedNotifications } = await import("@/lib/notifications/slack");
    await expect(retryFailedNotifications(user.id, new Date())).resolves.toMatchObject({
      unknownOutcomes: 1,
    });
    const [notification, deadLetter] = await Promise.all([
      admin
        .from("notifications")
        .select("status,deferred_until,last_error_code")
        .eq("id", stale.data.id)
        .single(),
      admin
        .from("dead_letter_records")
        .select("error_code,resolved_at")
        .eq("event_id", `notification-slack:${stale.data.id}`)
        .single(),
    ]);
    expect(notification.data).toMatchObject({
      status: "failed",
      deferred_until: null,
      last_error_code: "SLACK_DELIVERY_OUTCOME_UNKNOWN",
    });
    expect(deadLetter.data).toMatchObject({
      error_code: "SLACK_DELIVERY_OUTCOME_UNKNOWN",
      resolved_at: null,
    });
  });
});
