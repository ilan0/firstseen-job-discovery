// @vitest-environment node
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createClient, type User } from "@supabase/supabase-js";
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

describe.runIf(enabled)("canonical ingestion persistence", () => {
  let user: User;
  let companyId: string;
  let sourceId: string;
  const listing: NormalizedListing = {
    externalId: "ats-123",
    requisitionId: "REQ-123",
    title: "Software Engineer",
    descriptionText: "Full-time Software Engineer in Miami requiring 0-1 years of experience.",
    officialUrl: "https://jobs.lever.co/integration/ats-123",
    applyUrl: "https://jobs.lever.co/integration/ats-123",
    locations: ["Miami, FL"],
    workplaceType: "Hybrid",
    employmentType: "Full-time",
    postedAt: "2026-08-03T12:00:00Z",
    postedAtConfidence: "high",
    salaryText: null,
    sourceConfidence: "high",
    rawMetadata: {},
  };
  beforeAll(async () => {
    const created = await admin.auth.admin.createUser({
      email: `ingest-${randomUUID()}@firstseen.local`,
      password: `${randomUUID()}Aa9!`,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    user = created.data.user;
    const company = await admin
      .from("companies")
      .insert({
        user_id: user.id,
        name: "Integration",
        normalized_name: `integration-${randomUUID()}`,
        origin: "manual",
        domain: "integration.test",
      })
      .select("id")
      .single();
    if (company.error) throw company.error;
    companyId = company.data.id;
    const source = await admin
      .from("career_sources")
      .insert({
        user_id: user.id,
        company_id: companyId,
        connector_kind: "lever",
        base_url: "https://jobs.lever.co/integration",
        normalized_url: `https://jobs.lever.co/integration/${randomUUID()}`,
      })
      .select("id")
      .single();
    if (source.error) throw source.error;
    sourceId = source.data.id;
  });
  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
  });
  it("is idempotent, snapshots material changes, and deduplicates an ATS identity", async () => {
    const { ingestListing } = await import("@/lib/jobs/ingest");
    const context = {
      userId: user.id,
      companyId,
      companyDomain: "integration.test",
      sourceId,
      connectorKind: "lever" as const,
      tenantId: "integration",
      observedAt: new Date("2026-08-03T13:00:00Z"),
    };
    const first = await ingestListing(context, listing);
    expect(first.changed).toBe(true);
    expect(first.snapshotId).toBeTruthy();
    const unchanged = await ingestListing(
      { ...context, observedAt: new Date("2026-08-03T14:00:00Z") },
      listing,
    );
    expect(unchanged.jobId).toBe(first.jobId);
    expect(unchanged.changed).toBe(false);
    expect(unchanged.snapshotId).toBeNull();
    const changed = await ingestListing(
      { ...context, observedAt: new Date("2026-08-03T15:00:00Z") },
      { ...listing, descriptionText: `${listing.descriptionText} TypeScript required.` },
    );
    expect(changed.jobId).toBe(first.jobId);
    expect(changed.changed).toBe(true);
    const duplicate = await ingestListing(
      { ...context, observedAt: new Date("2026-08-03T16:00:00Z") },
      {
        ...listing,
        title: "Software Engineer, Platform",
        employmentType: "Contract",
        requisitionId: "REQ-UPDATED",
        postedAt: "2026-08-04T12:00:00Z",
        officialUrl: "https://jobs.lever.co/integration/alternate-url",
        applyUrl: "https://jobs.lever.co/integration/alternate-url",
        descriptionText: `${listing.descriptionText} TypeScript required.`,
      },
    );
    expect(duplicate.jobId).toBe(first.jobId);
    const jobs = await admin.from("canonical_jobs").select("id").eq("user_id", user.id);
    const canonical = await admin
      .from("canonical_jobs")
      .select("title,employment_type,requisition_id,posted_at,official_url")
      .eq("id", first.jobId)
      .single();
    const snapshots = await admin
      .from("job_description_snapshots")
      .select("id")
      .eq("user_id", user.id);
    expect(jobs.data).toHaveLength(1);
    expect(snapshots.data).toHaveLength(3);
    expect(canonical.data).toMatchObject({
      title: "Software Engineer, Platform",
      employment_type: "contract",
      requisition_id: "REQ-UPDATED",
      official_url: "https://jobs.lever.co/integration/alternate-url",
    });
    expect(canonical.data?.posted_at).toContain("2026-08-04");
  });
});
