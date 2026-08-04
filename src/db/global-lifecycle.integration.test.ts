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

describe.runIf(enabled)("global-to-private lifecycle projection", () => {
  const suffix = randomUUID();
  let user: User | null = null;
  let organizationId = "";
  let globalSourceId = "";
  let globalJobId = "";
  let legacyJobId = "";

  beforeAll(async () => {
    const created = await admin.auth.admin.createUser({
      email: `global-lifecycle-${suffix}@firstseen.local`,
      password: `${randomUUID()}Aa9!`,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    user = created.data.user;
    const organization = await admin
      .from("organizations")
      .insert({ name: `Lifecycle ${suffix}`, normalized_name: `lifecycle-${suffix}` })
      .select("id")
      .single();
    if (organization.error) throw organization.error;
    organizationId = organization.data.id;
    const globalSource = await admin
      .from("global_career_sources")
      .insert({
        organization_id: organizationId,
        connector_kind: "greenhouse",
        tenant_id: `lifecycle-${suffix}`,
        base_url: `https://boards.greenhouse.io/lifecycle-${suffix}`,
        normalized_url: `https://boards.greenhouse.io/lifecycle-${suffix}`,
      })
      .select("id")
      .single();
    if (globalSource.error) throw globalSource.error;
    globalSourceId = globalSource.data.id;
    const company = await admin
      .from("companies")
      .insert({
        user_id: user.id,
        organization_id: organizationId,
        name: `Lifecycle ${suffix}`,
        normalized_name: `lifecycle-${suffix}`,
        origin: "discovered",
      })
      .select("id")
      .single();
    if (company.error) throw company.error;
    const source = await admin
      .from("career_sources")
      .insert({
        user_id: user.id,
        company_id: company.data.id,
        connector_kind: "greenhouse",
        base_url: `https://boards.greenhouse.io/lifecycle-${suffix}`,
        normalized_url: `https://boards.greenhouse.io/lifecycle-${suffix}`,
        global_source_id: globalSourceId,
      })
      .select("id")
      .single();
    if (source.error) throw source.error;
    const officialUrl = `https://boards.greenhouse.io/lifecycle-${suffix}/jobs/1`;
    const globalJob = await admin
      .from("global_jobs")
      .insert({
        organization_id: organizationId,
        authoritative_source_id: globalSourceId,
        external_job_id: "1",
        title: "Software Engineer I",
        normalized_title: "software engineer i",
        official_url: officialUrl,
        normalized_official_url: officialUrl,
        apply_url: officialUrl,
        lifecycle_status: "open",
      })
      .select("id")
      .single();
    if (globalJob.error) throw globalJob.error;
    globalJobId = globalJob.data.id;
    const legacyJob = await admin
      .from("canonical_jobs")
      .insert({
        user_id: user.id,
        company_id: company.data.id,
        authoritative_source_id: source.data.id,
        external_job_id: "1",
        title: "Software Engineer I",
        normalized_title: "software engineer i",
        official_url: officialUrl,
        normalized_official_url: officialUrl,
        lifecycle_status: "open",
        global_job_id: globalJobId,
      })
      .select("id")
      .single();
    if (legacyJob.error) throw legacyJob.error;
    legacyJobId = legacyJob.data.id;
  });

  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
    if (organizationId) await admin.from("organizations").delete().eq("id", organizationId);
  });

  it("projects possibly-closed and closed transitions to every private linked job", async () => {
    const { applyGlobalClosure } = await import("@/lib/supply/global-source");
    const source = {
      id: globalSourceId,
      organizationId,
      organizationName: `Lifecycle ${suffix}`,
      organizationDomain: `lifecycle-${suffix}.example`,
      kind: "greenhouse" as const,
      tenantId: `lifecycle-${suffix}`,
      baseUrl: `https://boards.greenhouse.io/lifecycle-${suffix}`,
      publicConfig: {},
      etag: null,
      lastModified: null,
    };
    expect(await applyGlobalClosure(source, [], new Date("2026-08-04T13:00:00Z"))).toBe(1);
    let [global, legacy] = await Promise.all([
      admin
        .from("global_jobs")
        .select("lifecycle_status,consecutive_successful_misses")
        .eq("id", globalJobId)
        .single(),
      admin
        .from("canonical_jobs")
        .select("lifecycle_status,consecutive_successful_misses")
        .eq("id", legacyJobId)
        .single(),
    ]);
    expect(global.data).toMatchObject({
      lifecycle_status: "possibly_closed",
      consecutive_successful_misses: 1,
    });
    expect(legacy.data).toEqual(global.data);

    expect(await applyGlobalClosure(source, [], new Date("2026-08-04T14:00:00Z"))).toBe(1);
    [global, legacy] = await Promise.all([
      admin
        .from("global_jobs")
        .select("lifecycle_status,consecutive_successful_misses")
        .eq("id", globalJobId)
        .single(),
      admin
        .from("canonical_jobs")
        .select("lifecycle_status,consecutive_successful_misses")
        .eq("id", legacyJobId)
        .single(),
    ]);
    expect(global.data).toMatchObject({
      lifecycle_status: "closed",
      consecutive_successful_misses: 2,
    });
    expect(legacy.data).toEqual(global.data);
  });
});
