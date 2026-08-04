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

describe.runIf(enabled)("AI budget retry reservations", () => {
  let user: User | null = null;

  beforeAll(async () => {
    const created = await admin.auth.admin.createUser({
      email: `ai-budget-${randomUUID()}@firstseen.local`,
      password: `${randomUUID()}Aa9!`,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    user = created.data.user;
  });

  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
  });

  it("reopens one released routine reservation without duplicating the ledger", async () => {
    const { releaseAiBudget, reserveAiBudget, settleAiBudget } = await import("@/lib/ai/budget");
    const key = `routine-retry-${randomUUID()}`;
    const first = await reserveAiBudget(user!.id, key, 0.004);
    expect(first).toBeTruthy();
    await releaseAiBudget(first!, "TRANSIENT_TEST_FAILURE");
    const reopened = await reserveAiBudget(user!.id, key, 0.004);
    expect(reopened).toBe(first);

    const rows = await admin
      .from("usage_cost_ledger")
      .select("id,reservation_status,estimated_cost_usd")
      .eq("user_id", user!.id)
      .eq("idempotency_key", key);
    expect(rows.error).toBeNull();
    expect(rows.data).toEqual([
      { id: first, reservation_status: "reserved", estimated_cost_usd: 0.004 },
    ]);

    await settleAiBudget(first!, 0.004, { test: true });
    const blockerKey = `budget-blocker-${randomUUID()}`;
    const blocker = await admin.from("usage_cost_ledger").insert({
      user_id: user!.id,
      provider: "openai",
      operation: "job_analysis",
      idempotency_key: blockerKey,
      units: 1,
      unit_name: "analysis",
      estimated_cost_usd: 100,
      actual_cost_usd: 100,
      reservation_status: "settled",
    });
    if (blocker.error) throw blocker.error;
    expect(await reserveAiBudget(user!.id, key, 0.004)).toBe(first);
    const removed = await admin
      .from("usage_cost_ledger")
      .delete()
      .eq("user_id", user!.id)
      .eq("idempotency_key", blockerKey);
    if (removed.error) throw removed.error;
  });

  it("reopens one released Terra reservation while retaining cap accounting", async () => {
    const { releaseAiBudget, reserveAiEscalationBudget } = await import("@/lib/ai/budget");
    const routineRows = Array.from({ length: 10 }, (_, index) => ({
      user_id: user!.id,
      provider: "openai",
      operation: "job_analysis",
      idempotency_key: `routine-cap-fixture-${index}-${randomUUID()}`,
      units: 1,
      unit_name: "analysis",
      estimated_cost_usd: 0.05,
      actual_cost_usd: 0.05,
      reservation_status: "settled",
    }));
    const seeded = await admin.from("usage_cost_ledger").insert(routineRows);
    if (seeded.error) throw seeded.error;

    const key = `terra-retry-${randomUUID()}`;
    const first = await reserveAiEscalationBudget(user!.id, key, 0.016);
    expect(first).toBeTruthy();
    await releaseAiBudget(first!, "TRANSIENT_TEST_FAILURE");
    const reopened = await reserveAiEscalationBudget(user!.id, key, 0.016);
    expect(reopened).toBe(first);

    const rows = await admin
      .from("usage_cost_ledger")
      .select("id,reservation_status")
      .eq("user_id", user!.id)
      .eq("idempotency_key", key);
    expect(rows.data).toEqual([{ id: first, reservation_status: "reserved" }]);
  });
});
