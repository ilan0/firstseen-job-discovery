// @vitest-environment node
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { NormalizedListing } from "@/connectors/types";
import { ELIGIBILITY_RULE_VERSION } from "@/domain/eligibility";
import { RANKING_VERSION } from "@/domain/ranking";

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
  let companyId: string;
  let sourceId: string;

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
    companyId = company.data.id;
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
    sourceId = source.data.id;

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
        rule_version: ELIGIBILITY_RULE_VERSION,
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
      ranking_version: RANKING_VERSION,
    });
    if (recommendation.error) throw recommendation.error;
    const dimensions = await admin.from("ranking_dimensions").insert(
      [
        ["required_experience_alignment", 70],
        ["source_confidence", 95],
        ["referral_advantage", 100],
      ].map(([dimension, value]) => ({
        user_id: user.id,
        job_id: jobId,
        snapshot_id: ingest.snapshotId,
        dimension,
        value,
        confidence: 95,
        explanation: `${dimension} integration fixture.`,
        ranking_version: RANKING_VERSION,
      })),
    );
    if (dimensions.error) throw dimensions.error;
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
    expect(active[0]).toMatchObject({ jobId, freshnessBand: "stale", urgency: 52 });
    const { getJobDetail } = await import("@/lib/jobs/queue");
    expect((await getJobDetail(user.id, jobId))?.urgency).toBe(52);
    expect(await listQueue(user.id, "active", { postedWithin: "7d" })).toHaveLength(0);
    expect(await listQueue(user.id, "active", { postedWithin: "all" })).toHaveLength(1);

    const reopenedAt = new Date();
    const reopened = await admin
      .from("canonical_jobs")
      .update({ lifecycle_status: "reopened", reopened_at: reopenedAt.toISOString() })
      .eq("id", jobId);
    if (reopened.error) throw reopened.error;
    expect(await listQueue(user.id, "active", { postedWithin: "24h" })).toEqual([
      expect.objectContaining({
        jobId,
        lifecycleStatus: "reopened",
        freshnessBasis: "reopened_at",
        freshnessSection: "just_posted",
      }),
    ]);

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

  it("paginates the active queue with a stable keyset cursor", async () => {
    const now = Date.now();
    const jobs = await admin
      .from("canonical_jobs")
      .insert(
        Array.from({ length: 61 }, (_, index) => ({
          user_id: user.id,
          company_id: companyId,
          authoritative_source_id: sourceId,
          external_job_id: `page-${index}-${randomUUID()}`,
          title: `Paged Software Engineer ${index}`,
          normalized_title: `paged software engineer ${index}`,
          employment_type: "full_time",
          official_url: `https://jobs.lever.co/queue-integration/page-${randomUUID()}`,
          normalized_official_url: `https://jobs.lever.co/queue-integration/page-${randomUUID()}`,
          lifecycle_status: "open",
          posted_at: new Date(now - index * 60_000).toISOString(),
          posted_at_confidence: "high",
          verified_at: new Date(now).toISOString(),
        })),
      )
      .select("id");
    if (jobs.error) throw jobs.error;
    const snapshots = await admin
      .from("job_description_snapshots")
      .insert(
        jobs.data.map((job, index) => ({
          user_id: user.id,
          job_id: job.id,
          material_hash: `page-hash-${index}-${randomUUID()}`,
          description_text: "Full-time early-career software engineering role in Miami.",
          normalized_facts: { locations: { value: ["Miami, FL"] } },
        })),
      )
      .select("id,job_id");
    if (snapshots.error) throw snapshots.error;
    const decisions = await admin
      .from("eligibility_decisions")
      .insert(
        snapshots.data.map((snapshot) => ({
          user_id: user.id,
          job_id: snapshot.job_id,
          snapshot_id: snapshot.id,
          outcome: "eligible",
          rule_version: ELIGIBILITY_RULE_VERSION,
        })),
      )
      .select("id,job_id,snapshot_id");
    if (decisions.error) throw decisions.error;
    const recommendations = await admin.from("recommendations").insert(
      decisions.data.map((decision) => ({
        user_id: user.id,
        job_id: decision.job_id,
        snapshot_id: decision.snapshot_id,
        eligibility_decision_id: decision.id,
        band: "strong",
        urgency: 80,
        headline: "Pagination fixture",
        ranking_version: RANKING_VERSION,
      })),
    );
    if (recommendations.error) throw recommendations.error;
    const queued = await admin
      .from("queue_states")
      .insert(jobs.data.map((job) => ({ user_id: user.id, job_id: job.id, status: "active" })));
    if (queued.error) throw queued.error;

    const { listQueuePage } = await import("@/lib/jobs/queue");
    const first = await listQueuePage(user.id, "active", {
      postedWithin: "7d",
      sort: "posted_newest",
    });
    expect(first.items).toHaveLength(60);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await listQueuePage(user.id, "active", {
      postedWithin: "7d",
      sort: "posted_newest",
      cursor: first.nextCursor!,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.jobId))).toHaveProperty(
      "size",
      61,
    );
  });
});
