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

describe.runIf(enabled)("queue lifecycle and dynamic freshness", () => {
  let user: User;
  let jobId: string;

  beforeAll(async () => {
    const created = await admin.auth.admin.createUser({
      email: `queue-${randomUUID()}@firstseen.local`,
      password: `${randomUUID()}Aa9!`,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    user = created.data.user;
    const company = await admin
      .from("companies")
      .insert({
        user_id: user.id,
        name: "Queue Integration",
        normalized_name: `queue-integration-${randomUUID()}`,
        origin: "manual",
        domain: "queue.integration.test",
      })
      .select("id")
      .single();
    if (company.error) throw company.error;
    const source = await admin
      .from("career_sources")
      .insert({
        user_id: user.id,
        company_id: company.data.id,
        connector_kind: "lever",
        base_url: "https://jobs.lever.co/queue-integration",
        normalized_url: `https://jobs.lever.co/queue-integration/${randomUUID()}`,
      })
      .select("id")
      .single();
    if (source.error) throw source.error;

    const officialUrl = `https://jobs.lever.co/queue-integration/${randomUUID()}`;
    const listing: NormalizedListing = {
      externalId: randomUUID(),
      requisitionId: null,
      title: "Software Engineer I",
      descriptionText: "Full-time Software Engineer in Miami requiring one year of experience.",
      officialUrl,
      applyUrl: officialUrl,
      locations: ["Miami, FL"],
      workplaceType: "Onsite",
      employmentType: "Full-time",
      postedAt: "2026-06-01T12:00:00Z",
      postedAtConfidence: "high",
      salaryText: null,
      sourceConfidence: "high",
      rawMetadata: {},
    };
    const { ingestListing } = await import("@/lib/jobs/ingest");
    const ingest = await ingestListing(
      {
        userId: user.id,
        companyId: company.data.id,
        companyDomain: "queue.integration.test",
        sourceId: source.data.id,
        connectorKind: "lever",
        tenantId: "queue-integration",
        observedAt: new Date("2026-06-01T13:00:00Z"),
      },
      listing,
    );
    jobId = ingest.jobId;
    const decision = await admin
      .from("eligibility_decisions")
      .insert({
        user_id: user.id,
        job_id: jobId,
        snapshot_id: ingest.snapshotId,
        outcome: "eligible",
        rule_version: "queue-integration",
      })
      .select("id")
      .single();
    if (decision.error) throw decision.error;
    const recommendation = await admin.from("recommendations").insert({
      user_id: user.id,
      job_id: jobId,
      snapshot_id: ingest.snapshotId,
      eligibility_decision_id: decision.data.id,
      band: "hot",
      urgency: 100,
      headline: "Integration fixture",
      ranking_version: "queue-integration",
    });
    if (recommendation.error) throw recommendation.error;
    const queued = await admin.from("queue_states").insert({
      user_id: user.id,
      job_id: jobId,
      status: "active",
    });
    if (queued.error) throw queued.error;
  });

  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
  });

  it("deprioritizes aging jobs and removes closed listings only from the active queue", async () => {
    const { listQueue } = await import("@/lib/jobs/queue");
    const active = await listQueue(user.id, "active");
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ jobId, freshnessBand: "stale", urgency: 25 });

    const hidden = await admin
      .from("recommendations")
      .update({ band: "not_recommended" })
      .eq("job_id", jobId);
    if (hidden.error) throw hidden.error;
    expect(await listQueue(user.id, "active")).toHaveLength(0);
    const restored = await admin
      .from("recommendations")
      .update({ band: "hot" })
      .eq("job_id", jobId);
    if (restored.error) throw restored.error;

    const closed = await admin
      .from("canonical_jobs")
      .update({ lifecycle_status: "closed", closed_at: new Date().toISOString() })
      .eq("id", jobId);
    if (closed.error) throw closed.error;
    expect(await listQueue(user.id, "active")).toHaveLength(0);

    const saved = await admin.from("queue_states").update({ status: "saved" }).eq("job_id", jobId);
    if (saved.error) throw saved.error;
    expect(await listQueue(user.id, "saved")).toEqual([
      expect.objectContaining({ jobId, lifecycleStatus: "closed" }),
    ]);
  });
});
