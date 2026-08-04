// @vitest-environment node
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

dotenv.config({ path: ".env.local", quiet: true });
vi.mock("server-only", () => ({}));

const enabled = process.env.RUN_DATABASE_TESTS === "true";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SECRET_KEY ?? "",
  { auth: { autoRefreshToken: false, persistSession: false } },
);

describe.runIf(enabled)("global source scheduler outbox", () => {
  const suffix = randomUUID();
  const now = new Date("2026-08-04T16:00:00Z");
  let organizationId = "";
  let oldestSourceId = "";
  let prioritySourceId = "";

  beforeAll(async () => {
    const organization = await admin
      .from("organizations")
      .insert({ name: `Scheduler ${suffix}`, normalized_name: `scheduler-${suffix}` })
      .select("id")
      .single();
    if (organization.error) throw organization.error;
    organizationId = organization.data.id;
    for (const [index, tier, minutesOverdue] of [
      [0, "cold", 30],
      [1, "priority", 5],
    ] as const) {
      const source = await admin
        .from("global_career_sources")
        .insert({
          organization_id: organizationId,
          connector_kind: "lever",
          tenant_id: `scheduler-${index}-${suffix}`,
          base_url: `https://jobs.lever.co/scheduler-${index}-${suffix}`,
          normalized_url: `https://jobs.lever.co/scheduler-${index}-${suffix}`,
        })
        .select("id")
        .single();
      if (source.error) throw source.error;
      if (index === 0) oldestSourceId = source.data.id;
      else prioritySourceId = source.data.id;
      const schedule = await admin.from("global_scan_schedules").insert({
        career_source_id: source.data.id,
        monitoring_tier: tier,
        cadence_minutes: tier === "priority" ? 15 : 240,
        next_run_at: new Date(now.getTime() - minutesOverdue * 60_000).toISOString(),
      });
      if (schedule.error) throw schedule.error;
    }
  });

  afterAll(async () => {
    if (organizationId) await admin.from("organizations").delete().eq("id", organizationId);
  });

  it("claims the oldest due source and persists its event before dispatch", async () => {
    const { claimDueGlobalSources, loadPendingGlobalScans } =
      await import("@/lib/supply/global-scheduler");
    expect(await claimDueGlobalSources(now, 1)).toBe(1);
    const pending = await loadPendingGlobalScans(now);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      eventName: "supply/source.scan.requested.v2",
      payload: { sourceId: oldestSourceId },
    });

    const priority = await admin
      .from("global_scan_schedules")
      .select("next_run_at,leased_until")
      .eq("career_source_id", prioritySourceId)
      .single();
    expect(priority.data?.leased_until).toBeNull();
    expect(new Date(priority.data?.next_run_at ?? 0).getTime()).toBeLessThan(now.getTime());
  });

  it("recovers pending handoff, suppresses replay, and marks only delivered records", async () => {
    const { claimDueGlobalSources, loadPendingGlobalScans, markGlobalScansDispatched } =
      await import("@/lib/supply/global-scheduler");
    expect(await claimDueGlobalSources(now, 10)).toBe(1);
    expect(await claimDueGlobalSources(now, 10)).toBe(0);
    const pending = await loadPendingGlobalScans(now);
    expect(pending).toHaveLength(2);
    expect(await markGlobalScansDispatched([pending[0]!.id], now)).toBe(1);
    const recovered = await loadPendingGlobalScans(now);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.id).toBe(pending[1]!.id);
  });
});
