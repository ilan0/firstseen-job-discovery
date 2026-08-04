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

describe.runIf(enabled)("shared source user overlays", () => {
  const suffix = randomUUID();
  const users: User[] = [];
  let organizationId = "";
  let sameNameOrganizationId = "";
  let globalSourceId = "";
  let sameNameGlobalSourceId = "";

  beforeAll(async () => {
    for (let index = 0; index < 2; index += 1) {
      const created = await admin.auth.admin.createUser({
        email: `overlay-${index}-${suffix}@firstseen.local`,
        password: `${randomUUID()}Aa9!`,
        email_confirm: true,
      });
      if (created.error) throw created.error;
      users.push(created.data.user);
    }
    const organization = await admin
      .from("organizations")
      .insert({
        name: `Overlay ${suffix}`,
        normalized_name: `overlay-${suffix}`,
        canonical_domain: `overlay-${suffix}.example`,
      })
      .select("id")
      .single();
    if (organization.error) throw organization.error;
    organizationId = organization.data.id;
    const source = await admin
      .from("global_career_sources")
      .insert({
        organization_id: organizationId,
        connector_kind: "lever",
        tenant_id: `overlay-${suffix}`,
        base_url: `https://jobs.lever.co/overlay-${suffix}`,
        normalized_url: `https://jobs.lever.co/overlay-${suffix}`,
        parsing_confidence: 97,
      })
      .select("id")
      .single();
    if (source.error) throw source.error;
    globalSourceId = source.data.id;
    const schedule = await admin.from("global_scan_schedules").insert({
      career_source_id: globalSourceId,
      next_run_at: "2026-08-05T00:00:00Z",
    });
    if (schedule.error) throw schedule.error;

    const sameNameOrganization = await admin
      .from("organizations")
      .insert({
        name: `Overlay ${suffix}`,
        normalized_name: `overlay-${suffix}`,
        canonical_domain: `different-${suffix}.example`,
      })
      .select("id")
      .single();
    if (sameNameOrganization.error) throw sameNameOrganization.error;
    sameNameOrganizationId = sameNameOrganization.data.id;
    const sameNameSource = await admin
      .from("global_career_sources")
      .insert({
        organization_id: sameNameOrganizationId,
        connector_kind: "lever",
        tenant_id: `different-${suffix}`,
        base_url: `https://jobs.lever.co/different-${suffix}`,
        normalized_url: `https://jobs.lever.co/different-${suffix}`,
        parsing_confidence: 97,
      })
      .select("id")
      .single();
    if (sameNameSource.error) throw sameNameSource.error;
    sameNameGlobalSourceId = sameNameSource.data.id;
    const sameNameSchedule = await admin.from("global_scan_schedules").insert({
      career_source_id: sameNameGlobalSourceId,
      next_run_at: "2026-08-05T00:00:00Z",
    });
    if (sameNameSchedule.error) throw sameNameSchedule.error;
  });

  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
    if (organizationId) await admin.from("organizations").delete().eq("id", organizationId);
    if (sameNameOrganizationId)
      await admin.from("organizations").delete().eq("id", sameNameOrganizationId);
  });

  it("attaches one global source to private users idempotently", async () => {
    const { attachGlobalSourceToUser } = await import("@/lib/supply/user-overlay");
    const attachedAt = new Date("2026-08-04T17:00:00Z");
    for (const user of users) {
      expect(await attachGlobalSourceToUser(user.id, globalSourceId, attachedAt)).toMatchObject({
        globalSourceId,
      });
      expect(await attachGlobalSourceToUser(user.id, globalSourceId, attachedAt)).toMatchObject({
        globalSourceId,
      });
    }
    const [companies, sources, follows, schedule] = await Promise.all([
      admin.from("companies").select("id,user_id,active").eq("organization_id", organizationId),
      admin
        .from("career_sources")
        .select("id,user_id,global_source_id")
        .eq("global_source_id", globalSourceId),
      admin
        .from("user_company_follows")
        .select("id,user_id,organization_id")
        .eq("organization_id", organizationId),
      admin
        .from("global_scan_schedules")
        .select("next_run_at")
        .eq("career_source_id", globalSourceId)
        .single(),
    ]);
    expect(companies.data).toHaveLength(2);
    expect(sources.data).toHaveLength(2);
    expect(follows.data).toHaveLength(2);
    expect(sources.data?.every((source) => source.global_source_id === globalSourceId)).toBe(true);
    expect(schedule.data?.next_run_at).toBe("2026-08-04T17:00:00+00:00");
  });

  it("does not reactivate a sticky inactive company", async () => {
    const { attachGlobalSourceToUser } = await import("@/lib/supply/user-overlay");
    const deactivated = await admin
      .from("companies")
      .update({ active: false })
      .eq("user_id", users[0]!.id)
      .eq("organization_id", organizationId);
    if (deactivated.error) throw deactivated.error;
    expect(
      await attachGlobalSourceToUser(
        users[0]!.id,
        globalSourceId,
        new Date("2026-08-04T18:00:00Z"),
      ),
    ).toBeNull();
    const company = await admin
      .from("companies")
      .select("active")
      .eq("user_id", users[0]!.id)
      .eq("organization_id", organizationId)
      .single();
    expect(company.data?.active).toBe(false);
  });

  it("keeps same-named employers with different verified identities separate", async () => {
    const { attachGlobalSourceToUser } = await import("@/lib/supply/user-overlay");
    expect(
      await attachGlobalSourceToUser(
        users[1]!.id,
        sameNameGlobalSourceId,
        new Date("2026-08-04T19:00:00Z"),
      ),
    ).toMatchObject({ globalSourceId: sameNameGlobalSourceId });

    const companies = await admin
      .from("companies")
      .select("organization_id")
      .eq("user_id", users[1]!.id)
      .eq("normalized_name", `overlay-${suffix}`);
    expect(companies.error).toBeNull();
    expect(companies.data?.map((company) => company.organization_id).sort()).toEqual(
      [organizationId, sameNameOrganizationId].sort(),
    );
  });
});
