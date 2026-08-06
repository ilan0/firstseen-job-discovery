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

describe.runIf(enabled)("Push Policy V2 durable delivery", () => {
  const suffix = randomUUID();
  let user: User;
  let organizationId = "";
  let jobId = "";
  let snapshotId = "";

  beforeAll(async () => {
    const created = await admin.auth.admin.createUser({
      email: `push-policy-${suffix}@firstseen.local`,
      password: `${randomUUID()}Aa9!`,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    user = created.data.user;
    const organization = await admin
      .from("organizations")
      .insert({ name: `Push Policy ${suffix}`, normalized_name: `push-policy-${suffix}` })
      .select("id")
      .single();
    if (organization.error) throw organization.error;
    organizationId = organization.data.id;
    const company = await admin
      .from("companies")
      .insert({
        user_id: user.id,
        organization_id: organizationId,
        name: `Push Policy ${suffix}`,
        normalized_name: `push-policy-${suffix}`,
        origin: "manual",
        interested: false,
      })
      .select("id")
      .single();
    if (company.error) throw company.error;
    const sourceUrl = `https://boards.greenhouse.io/push-policy-${suffix}`;
    const source = await admin
      .from("career_sources")
      .insert({
        user_id: user.id,
        company_id: company.data.id,
        connector_kind: "greenhouse",
        base_url: sourceUrl,
        normalized_url: sourceUrl,
        parsing_confidence: 100,
      })
      .select("id")
      .single();
    if (source.error) throw source.error;
    const officialUrl = `${sourceUrl}/jobs/1`;
    const job = await admin
      .from("canonical_jobs")
      .insert({
        user_id: user.id,
        company_id: company.data.id,
        authoritative_source_id: source.data.id,
        title: "Software Engineer I",
        normalized_title: "software engineer i",
        employment_type: "full_time",
        official_url: officialUrl,
        normalized_official_url: officialUrl,
        lifecycle_status: "open",
        posted_at: "2026-08-06T01:00:00.000Z",
        posted_at_confidence: "high",
        first_seen_at: "2026-08-06T02:00:00.000Z",
        verified_at: "2026-08-06T02:00:00.000Z",
        last_seen_at: "2026-08-06T02:00:00.000Z",
      })
      .select("id")
      .single();
    if (job.error) throw job.error;
    jobId = job.data.id;
    const snapshot = await admin
      .from("job_description_snapshots")
      .insert({
        user_id: user.id,
        job_id: jobId,
        material_hash: randomUUID(),
        description_text: "Entry-level full-time software engineer.",
      })
      .select("id")
      .single();
    if (snapshot.error) throw snapshot.error;
    snapshotId = snapshot.data.id;
    const eligibility = await admin
      .from("eligibility_decisions")
      .insert({
        user_id: user.id,
        job_id: jobId,
        snapshot_id: snapshotId,
        outcome: "eligible",
        rule_version: "push-test",
        uncertain_fields: [],
      })
      .select("id")
      .single();
    if (eligibility.error) throw eligibility.error;
    const recommendation = await admin.from("recommendations").insert({
      user_id: user.id,
      job_id: jobId,
      snapshot_id: snapshotId,
      eligibility_decision_id: eligibility.data.id,
      band: "strong",
      urgency: 90,
      headline: "Strong early-career fit",
      ranking_version: "push-test",
      active: true,
    });
    if (recommendation.error) throw recommendation.error;
    const queue = await admin
      .from("queue_states")
      .insert({ user_id: user.id, job_id: jobId, status: "active" });
    if (queue.error) throw queue.error;

    const { ensureWebPushChannel } = await import("@/lib/notifications/preferences");
    const channel = await ensureWebPushChannel(user.id);
    const { encryptCapability } = await import("@/lib/security/encrypted-capability");
    const subscription = await admin.from("push_subscriptions").insert({
      user_id: user.id,
      channel_id: channel.id,
      endpoint_hash: randomUUID(),
      encrypted_capability: encryptCapability(
        {
          endpoint: `https://fcm.googleapis.com/fcm/send/push-policy-${suffix}`,
          expirationTime: null,
          keys: { p256dh: "A".repeat(44), auth: "B".repeat(22) },
        },
        process.env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY ?? "",
      ),
    });
    if (subscription.error) throw subscription.error;
  });

  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
    if (organizationId) await admin.from("organizations").delete().eq("id", organizationId);
  });

  it("defers during quiet hours and suppresses after a user acts before wake-up", async () => {
    const { queueJobAlert } = await import("@/lib/notifications/orchestrate");
    const queued = await queueJobAlert({
      userId: user.id,
      jobId,
      snapshotId,
      title: "Software Engineer I",
      company: `Push Policy ${suffix}`,
      headline: "Strong early-career fit",
      urgency: 90,
      hasReferral: false,
      band: "strong",
      roleFamily: "general_swe",
      eligibilityOutcome: "eligible",
      uncertainFields: [],
      officialUrl: `https://boards.greenhouse.io/push-policy-${suffix}/jobs/1`,
      freshnessAgeHours: 2,
      freshnessBasis: "posted_at",
      primaryConcern: "None",
      occurrenceId: "opening:initial",
      now: new Date("2026-08-06T03:00:00.000Z"),
    });
    expect(queued).toBeTruthy();
    const delivery = await admin
      .from("notification_deliveries")
      .select("id,status,next_attempt_at")
      .eq("logical_notification_id", queued!.id)
      .single();
    expect(delivery.data?.status).toBe("deferred");
    expect(new Date(delivery.data?.next_attempt_at ?? 0).toISOString()).toBe(
      "2026-08-06T11:00:00.000Z",
    );
    const outbox = await admin
      .from("outbox_events")
      .select("status,available_at,payload")
      .eq("event_name", "firstseen/push.delivery.requested")
      .eq("aggregate_id", delivery.data!.id)
      .single();
    expect(outbox.data?.status).toBe("pending");
    expect(new Date(outbox.data?.available_at ?? 0).toISOString()).toBe("2026-08-06T11:00:00.000Z");
    expect(outbox.data?.payload).toMatchObject({ userId: user.id, deliveryId: delivery.data!.id });

    await admin
      .from("queue_states")
      .update({ status: "saved", status_changed_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("job_id", jobId);
    const { deliverWebPush } = await import("@/lib/notifications/web-push");
    const sender = vi.fn();
    await expect(deliverWebPush(delivery.data!.id, sender)).resolves.toMatchObject({
      state: "suppressed",
      reason: "acted",
    });
    expect(sender).not.toHaveBeenCalled();
    const [storedDelivery, notification] = await Promise.all([
      admin
        .from("notification_deliveries")
        .select("status,last_error_code")
        .eq("id", delivery.data!.id)
        .single(),
      admin.from("notifications").select("status").eq("id", queued!.id).single(),
    ]);
    expect(storedDelivery.data).toMatchObject({
      status: "suppressed",
      last_error_code: "PUSH_SUPPRESSED_ACTED",
    });
    expect(notification.data?.status).toBe("suppressed");
  });

  it("records a suppressed occurrence so enabling alerts cannot retroactively blast it", async () => {
    await admin
      .from("queue_states")
      .update({ status: "active", status_changed_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("job_id", jobId);
    const channel = await admin
      .from("notification_channels")
      .select("id")
      .eq("user_id", user.id)
      .eq("kind", "web_push")
      .single();
    await admin
      .from("notification_preferences")
      .update({ enabled: false, alert_preset: "off" })
      .eq("channel_id", channel.data!.id)
      .is("organization_id", null);
    const candidate = {
      userId: user.id,
      jobId,
      snapshotId,
      title: "Software Engineer I",
      company: `Push Policy ${suffix}`,
      headline: "Strong early-career fit",
      urgency: 90,
      hasReferral: false,
      band: "strong" as const,
      roleFamily: "general_swe" as const,
      eligibilityOutcome: "eligible" as const,
      uncertainFields: [],
      officialUrl: `https://boards.greenhouse.io/push-policy-${suffix}/jobs/1`,
      freshnessAgeHours: 1,
      freshnessBasis: "reopened_at" as const,
      primaryConcern: "None",
      occurrenceId: "reopened:2026-08-06T12:00:00.000Z",
      now: new Date("2026-08-06T13:00:00.000Z"),
    };
    const { queueJobAlert } = await import("@/lib/notifications/orchestrate");
    await expect(queueJobAlert(candidate)).resolves.toBeNull();
    await admin
      .from("notification_preferences")
      .update({ enabled: true, alert_preset: "balanced" })
      .eq("channel_id", channel.data!.id)
      .is("organization_id", null);
    await expect(queueJobAlert(candidate)).resolves.toBeNull();
    const key = `job-alert:${jobId}:${candidate.occurrenceId}`;
    const [notifications, deliveries] = await Promise.all([
      admin
        .from("notifications")
        .select("id,status,reason_codes")
        .eq("user_id", user.id)
        .eq("idempotency_key", key),
      admin
        .from("notification_deliveries")
        .select("id")
        .eq("user_id", user.id)
        .eq("reason", "disabled"),
    ]);
    expect(notifications.data).toEqual([
      expect.objectContaining({ status: "suppressed", reason_codes: ["disabled"] }),
    ]);
    expect(deliveries.data).toEqual([]);
  });
});
