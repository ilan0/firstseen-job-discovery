// @vitest-environment node
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { NormalizedListing } from "@/connectors/types";

dotenv.config({ path: ".env.local", quiet: true });
vi.mock("server-only", () => ({}));

const enabled = process.env.RUN_DATABASE_TESTS === "true";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SECRET_KEY ?? "",
  { auth: { autoRefreshToken: false, persistSession: false } },
);

describe.runIf(enabled)("shared canonical supply", () => {
  let organizationId: string;
  let sourceId: string;
  const suffix = randomUUID();
  const listing: NormalizedListing = {
    externalId: `job-${suffix}`,
    requisitionId: null,
    title: "Software Engineer I",
    descriptionText:
      "Full-time software engineer. 0-1 years required. Remote in the United States.",
    officialUrl: `https://jobs.lever.co/global-${suffix}/job-${suffix}`,
    applyUrl: `https://jobs.lever.co/global-${suffix}/job-${suffix}/apply`,
    locations: ["Remote - United States"],
    workplaceType: "Remote",
    employmentType: "Full-time",
    postedAt: "2026-08-04T10:00:00Z",
    postedAtConfidence: "high",
    salaryText: null,
    sourceConfidence: "high",
    rawMetadata: {},
  };

  beforeAll(async () => {
    const organization = await admin
      .from("organizations")
      .insert({ name: `Global ${suffix}`, normalized_name: `global-${suffix}` })
      .select("id")
      .single();
    if (organization.error) throw organization.error;
    organizationId = organization.data.id;
    const source = await admin
      .from("global_career_sources")
      .insert({
        organization_id: organizationId,
        connector_kind: "lever",
        tenant_id: `global-${suffix}`,
        base_url: `https://jobs.lever.co/global-${suffix}`,
        normalized_url: `https://jobs.lever.co/global-${suffix}`,
      })
      .select("id")
      .single();
    if (source.error) throw source.error;
    sourceId = source.data.id;
  });

  afterAll(async () => {
    if (organizationId) await admin.from("organizations").delete().eq("id", organizationId);
  });

  it("stores one job and snapshot across replay, then versions a material change", async () => {
    const { ingestGlobalListing } = await import("@/lib/supply/global-ingest");
    const { coverageUrlHash } = await import("@/lib/coverage/identity");
    const benchmark = await admin.from("coverage_benchmarks").insert({
      cohort: "remote-general-swe",
      source_family: "lever",
      expected_official_url_hash: coverageUrlHash(listing.officialUrl),
      independent_observed_at: "2026-08-04T09:55:00Z",
      eligibility_label: "eligible",
      benchmark_version: `test-${suffix}`,
    });
    if (benchmark.error) throw benchmark.error;
    const context = {
      organizationId,
      organizationDomain: `global-${suffix}.test`,
      sourceId,
      connectorKind: "lever" as const,
      tenantId: `global-${suffix}`,
      observedAt: new Date("2026-08-04T10:05:00Z"),
    };
    const first = await ingestGlobalListing(context, listing);
    const replay = await ingestGlobalListing(
      { ...context, observedAt: new Date("2026-08-04T10:10:00Z") },
      listing,
    );
    expect(replay).toMatchObject({
      jobId: first.jobId,
      snapshotId: first.snapshotId,
      changed: false,
    });

    const changed = await ingestGlobalListing(
      { ...context, observedAt: new Date("2026-08-04T10:15:00Z") },
      { ...listing, descriptionText: `${listing.descriptionText} TypeScript is required.` },
    );
    expect(changed).toMatchObject({ jobId: first.jobId, changed: true });
    expect(changed.snapshotId).not.toBe(first.snapshotId);
    const [jobs, snapshots, links, events] = await Promise.all([
      admin.from("global_jobs").select("id").eq("id", first.jobId),
      admin.from("global_job_snapshots").select("id").eq("job_id", first.jobId),
      admin.from("global_job_source_links").select("id").eq("job_id", first.jobId),
      admin.from("global_job_lifecycle_events").select("reason").eq("job_id", first.jobId),
    ]);
    expect(jobs.data).toHaveLength(1);
    expect(snapshots.data).toHaveLength(2);
    expect(links.data).toHaveLength(1);
    expect(events.data?.map((event) => event.reason)).toEqual(
      expect.arrayContaining([
        "Official listing first verified",
        "Official listing materially changed",
      ]),
    );
    const measured = await admin
      .from("coverage_benchmarks")
      .select("matched,firstseen_detected_at,detection_latency_minutes")
      .eq("benchmark_version", `test-${suffix}`)
      .single();
    expect(measured.error).toBeNull();
    expect(measured.data).toMatchObject({
      matched: true,
      firstseen_detected_at: "2026-08-04T10:05:00+00:00",
      detection_latency_minutes: 10,
    });
  });

  it("fails closed until an activated source-rights policy permits requests", async () => {
    const { loadGlobalSource } = await import("@/lib/supply/global-source");
    expect(await loadGlobalSource(sourceId)).toBeNull();
    const policy = await admin.from("global_source_policies").insert({
      career_source_id: sourceId,
      provider: "lever",
      policy_version: `test-${suffix}`,
      status: "approved_official_public_source",
      may_request: true,
      may_use_transiently: true,
      may_persist: true,
      may_display: true,
      activated_at: new Date().toISOString(),
    });
    if (policy.error) throw policy.error;
    expect(await loadGlobalSource(sourceId)).toMatchObject({ id: sourceId, kind: "lever" });
  });
});
