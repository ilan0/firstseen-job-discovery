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

describe.runIf(enabled)("shared global source monitoring demand", () => {
  const suffix = randomUUID();
  const users: User[] = [];
  const companyIds: string[] = [];
  let organizationId = "";
  let globalSourceId = "";

  beforeAll(async () => {
    for (let index = 0; index < 2; index += 1) {
      const created = await admin.auth.admin.createUser({
        email: `global-demand-${index}-${suffix}@firstseen.local`,
        password: `${randomUUID()}Aa9!`,
        email_confirm: true,
      });
      if (created.error) throw created.error;
      users.push(created.data.user);
    }
    const organization = await admin
      .from("organizations")
      .insert({ name: `Demand ${suffix}`, normalized_name: `demand-${suffix}` })
      .select("id")
      .single();
    if (organization.error) throw organization.error;
    organizationId = organization.data.id;
    const source = await admin
      .from("global_career_sources")
      .insert({
        organization_id: organizationId,
        connector_kind: "lever",
        tenant_id: `demand-${suffix}`,
        base_url: `https://jobs.lever.co/demand-${suffix}`,
        normalized_url: `https://jobs.lever.co/demand-${suffix}`,
      })
      .select("id")
      .single();
    if (source.error) throw source.error;
    globalSourceId = source.data.id;
    const schedule = await admin.from("global_scan_schedules").insert({
      career_source_id: globalSourceId,
      monitoring_tier: "cold",
      cadence_minutes: 240,
      next_run_at: "2026-08-07T00:00:00Z",
    });
    if (schedule.error) throw schedule.error;

    const { attachGlobalSourceToUser } = await import("@/lib/supply/user-overlay");
    for (const user of users) {
      const attached = await attachGlobalSourceToUser(
        user.id,
        globalSourceId,
        new Date("2026-08-06T10:00:00Z"),
      );
      if (!attached) throw new Error("Test overlay could not be attached.");
      companyIds.push(attached.companyId);
    }
    const priority = await admin
      .from("watchlists")
      .update({ monitoring_tier: "priority", cadence_minutes: 15, active: true })
      .eq("user_id", users[0]!.id)
      .eq("company_id", companyIds[0]!);
    if (priority.error) throw priority.error;
    const standard = await admin
      .from("watchlists")
      .update({ monitoring_tier: "standard", cadence_minutes: 60, active: true })
      .eq("user_id", users[1]!.id)
      .eq("company_id", companyIds[1]!);
    if (standard.error) throw standard.error;
  });

  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
    if (organizationId) await admin.from("organizations").delete().eq("id", organizationId);
  });

  async function schedule() {
    const result = await admin
      .from("global_scan_schedules")
      .select("monitoring_tier,cadence_minutes,next_run_at,active")
      .eq("career_source_id", globalSourceId)
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  it("uses the strictest watcher and relaxes cadence as demand disappears", async () => {
    const { refreshGlobalSourceDemand } = await import("@/lib/supply/demand");
    await refreshGlobalSourceDemand([globalSourceId], new Date("2026-08-06T12:00:00Z"));
    await expect(schedule()).resolves.toMatchObject({
      monitoring_tier: "priority",
      cadence_minutes: 15,
      next_run_at: "2026-08-06T10:00:00+00:00",
    });

    const removePriority = await admin
      .from("watchlists")
      .update({ active: false, monitoring_tier: "quarantined" })
      .eq("user_id", users[0]!.id)
      .eq("company_id", companyIds[0]!);
    if (removePriority.error) throw removePriority.error;
    await refreshGlobalSourceDemand([globalSourceId], new Date("2026-08-06T12:01:00Z"));
    await expect(schedule()).resolves.toMatchObject({
      monitoring_tier: "standard",
      cadence_minutes: 60,
      next_run_at: "2026-08-06T13:01:00+00:00",
    });

    const removeStandard = await admin
      .from("watchlists")
      .update({ active: false, monitoring_tier: "quarantined" })
      .eq("user_id", users[1]!.id)
      .eq("company_id", companyIds[1]!);
    if (removeStandard.error) throw removeStandard.error;
    await refreshGlobalSourceDemand([globalSourceId], new Date("2026-08-06T12:02:00Z"));
    await expect(schedule()).resolves.toMatchObject({
      monitoring_tier: "cold",
      cadence_minutes: 240,
      next_run_at: "2026-08-06T16:02:00+00:00",
    });

    const quarantine = await admin
      .from("global_scan_schedules")
      .update({ active: false })
      .eq("career_source_id", globalSourceId);
    if (quarantine.error) throw quarantine.error;
    const reactivateWatcher = await admin
      .from("watchlists")
      .update({ active: true, monitoring_tier: "priority", cadence_minutes: 15 })
      .eq("user_id", users[0]!.id)
      .eq("company_id", companyIds[0]!);
    if (reactivateWatcher.error) throw reactivateWatcher.error;
    await refreshGlobalSourceDemand([globalSourceId], new Date("2026-08-06T12:03:00Z"));
    await expect(schedule()).resolves.toMatchObject({
      active: false,
      monitoring_tier: "priority",
      cadence_minutes: 15,
    });
    const unchanged = await schedule();
    await refreshGlobalSourceDemand([globalSourceId], new Date("2026-08-06T12:04:00Z"));
    expect((await schedule()).next_run_at).toBe(unchanged.next_run_at);
    await expect(
      refreshGlobalSourceDemand([randomUUID()], new Date("2026-08-06T12:05:00Z")),
    ).resolves.toEqual([]);
  });
});
