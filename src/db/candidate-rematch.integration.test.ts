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

describe.runIf(enabled)("candidate preference rematching", () => {
  const suffix = randomUUID();
  let user: User | null = null;
  let companyId: string;
  let sourceId: string;
  let jobId: string;
  let currentSnapshotId: string;
  let staleSnapshotId: string;

  const listing: NormalizedListing = {
    externalId: `rematch-${suffix}`,
    requisitionId: null,
    title: "Software Engineer I",
    descriptionText: "Full-time software engineer in Miami requiring one year of experience.",
    officialUrl: `https://jobs.lever.co/rematch-${suffix}/job-${suffix}`,
    applyUrl: `https://jobs.lever.co/rematch-${suffix}/job-${suffix}/apply`,
    locations: ["Miami, FL"],
    workplaceType: "On-site",
    employmentType: "Full-time",
    postedAt: "2026-08-04T12:00:00Z",
    postedAtConfidence: "high",
    salaryText: "$80,000",
    sourceConfidence: "high",
    rawMetadata: {},
  };

  beforeAll(async () => {
    const created = await admin.auth.admin.createUser({
      email: `candidate-rematch-${suffix}@firstseen.local`,
      password: `${randomUUID()}Aa9!`,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    user = created.data.user;
    const company = await admin
      .from("companies")
      .insert({
        user_id: user.id,
        name: `Candidate Rematch ${suffix}`,
        normalized_name: `candidate-rematch-${suffix}`,
        origin: "manual",
        domain: `rematch-${suffix}.test`,
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
        base_url: `https://jobs.lever.co/rematch-${suffix}`,
        normalized_url: `https://jobs.lever.co/rematch-${suffix}`,
        parsing_confidence: 98,
      })
      .select("id")
      .single();
    if (source.error) throw source.error;
    sourceId = source.data.id;
    const { ingestListing } = await import("@/lib/jobs/ingest");
    const first = await ingestListing(
      {
        userId: user.id,
        companyId,
        companyDomain: `rematch-${suffix}.test`,
        sourceId,
        connectorKind: "lever",
        tenantId: `rematch-${suffix}`,
        observedAt: new Date("2026-08-04T12:05:00Z"),
      },
      listing,
    );
    jobId = first.jobId;
    staleSnapshotId = first.snapshotId!;
    const changed = await ingestListing(
      {
        userId: user.id,
        companyId,
        companyDomain: `rematch-${suffix}.test`,
        sourceId,
        connectorKind: "lever",
        tenantId: `rematch-${suffix}`,
        observedAt: new Date("2026-08-04T12:10:00Z"),
      },
      { ...listing, descriptionText: `${listing.descriptionText} TypeScript is required.` },
    );
    currentSnapshotId = changed.snapshotId!;
  });

  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
  });

  it("selects only current open snapshots for rematching", async () => {
    const { loadLegacyRematchTasks } = await import("@/lib/jobs/rematch");
    await expect(loadLegacyRematchTasks(user!.id)).resolves.toEqual([
      { userId: user!.id, jobId, snapshotId: currentSnapshotId },
    ]);
  });

  it("rejects delayed stale events and reconstructs original provider facts", async () => {
    const { loadLegacyPersonalizationTask } = await import("@/lib/jobs/rematch");
    await expect(
      loadLegacyPersonalizationTask({ userId: user!.id, jobId, snapshotId: staleSnapshotId }),
    ).resolves.toBeNull();
    await expect(
      loadLegacyPersonalizationTask({ userId: user!.id, jobId, snapshotId: currentSnapshotId }),
    ).resolves.toMatchObject({
      listing: {
        employmentType: "Full-time",
        locations: ["Miami, FL"],
        workplaceType: "On-site",
        salaryText: "$80,000",
      },
      hasReferral: false,
      sourceConfidence: 98,
    });
  });
});
