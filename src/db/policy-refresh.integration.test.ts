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

describe.runIf(enabled)("unchanged-listing policy refresh", () => {
  let user: User;
  let companyId: string;
  let sourceId: string;
  const listing: NormalizedListing = {
    externalId: "policy-senior-1",
    requisitionId: null,
    title: "Manager, Software Engineering",
    descriptionText: "This is a full-time role. 5+ years of engineering experience is required.",
    officialUrl: "https://jobs.lever.co/policy-refresh/policy-senior-1",
    applyUrl: "https://jobs.lever.co/policy-refresh/policy-senior-1",
    locations: ["Remote - United States"],
    workplaceType: "Remote",
    employmentType: "Full-time",
    postedAt: "2026-08-03T12:00:00Z",
    postedAtConfidence: "high",
    salaryText: null,
    sourceConfidence: "high",
    rawMetadata: {},
  };

  beforeAll(async () => {
    const created = await admin.auth.admin.createUser({
      email: `policy-${randomUUID()}@firstseen.local`,
      password: `${randomUUID()}Aa9!`,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    user = created.data.user;
    const company = await admin
      .from("companies")
      .insert({
        user_id: user.id,
        name: "Policy Refresh",
        normalized_name: `policy-refresh-${randomUUID()}`,
        origin: "manual",
        domain: "policy-refresh.test",
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
        base_url: "https://jobs.lever.co/policy-refresh",
        normalized_url: `https://jobs.lever.co/policy-refresh/${randomUUID()}`,
      })
      .select("id")
      .single();
    if (source.error) throw source.error;
    sourceId = source.data.id;
  });

  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
  });

  it("re-evaluates stale policy versions without making another AI call", async () => {
    const { ingestListing } = await import("@/lib/jobs/ingest");
    const { analyzeAndRankListing } = await import("@/lib/jobs/analyze-and-rank");
    const context = {
      userId: user.id,
      companyId,
      companyDomain: "policy-refresh.test",
      sourceId,
      connectorKind: "lever" as const,
      tenantId: "policy-refresh",
      observedAt: new Date("2026-08-03T13:00:00Z"),
    };
    const firstIngest = await ingestListing(context, listing);
    const first = await analyzeAndRankListing({
      userId: user.id,
      listing,
      ingest: firstIngest,
      hasReferral: false,
    });
    expect(first.state).toBe("analyzed");
    if (first.state !== "analyzed") return;
    expect(first.decision.outcome).toBe("ineligible");

    const existingRecommendation = await admin
      .from("recommendations")
      .update({ ranking_version: "stale-ranking", active: true })
      .eq("job_id", firstIngest.jobId);
    if (existingRecommendation.error) throw existingRecommendation.error;
    const existingDecision = await admin
      .from("eligibility_decisions")
      .update({ rule_version: "stale-rule" })
      .eq("job_id", firstIngest.jobId);
    if (existingDecision.error) throw existingDecision.error;

    const { sourceNeedsPolicyRefresh } = await import("@/lib/scans/scan-source");
    const storedSource = {
      id: sourceId,
      userId: user.id,
      companyId,
      companyName: "Policy Refresh",
      companyDomain: "policy-refresh.test",
      kind: "lever" as const,
      baseUrl: "https://jobs.lever.co/policy-refresh",
      tenantId: "policy-refresh",
      etag: '"stale-conditional-validator"',
      lastModified: "Sun, 03 Aug 2026 12:00:00 GMT",
    };
    expect(await sourceNeedsPolicyRefresh(storedSource)).toBe(true);

    const unchangedIngest = await ingestListing(
      { ...context, observedAt: new Date("2026-08-03T14:00:00Z") },
      listing,
    );
    expect(unchangedIngest.changed).toBe(false);
    const refreshed = await analyzeAndRankListing({
      userId: user.id,
      listing,
      ingest: unchangedIngest,
      hasReferral: false,
    });
    expect(refreshed.state).toBe("analyzed");
    if (refreshed.state !== "analyzed") return;
    expect(refreshed.decision.outcome).toBe("ineligible");

    const current = await admin
      .from("recommendations")
      .select("ranking_version,eligibility_decisions!inner(rule_version)")
      .eq("job_id", firstIngest.jobId)
      .eq("active", true)
      .single();
    expect(current.error).toBeNull();
    expect(current.data?.ranking_version).not.toBe("stale-ranking");
    expect(current.data?.eligibility_decisions).toMatchObject({ rule_version: expect.any(String) });
    expect(await sourceNeedsPolicyRefresh(storedSource)).toBe(false);
    const usage = await admin
      .from("usage_cost_ledger")
      .select("id")
      .eq("user_id", user.id)
      .eq("provider", "openai");
    expect(usage.data).toEqual([]);
  });

  it("reuses and preserves a validated AI extraction when only policy versions change", async () => {
    const { AI_ANALYSIS_SCHEMA_VERSION, jobAnalysisPromptHash } = await import("@/ai");
    const { ingestListing } = await import("@/lib/jobs/ingest");
    const { analyzeAndRankListing } = await import("@/lib/jobs/analyze-and-rank");
    const eligibleListing: NormalizedListing = {
      ...listing,
      externalId: "policy-early-career-1",
      title: "Software Engineer I",
      descriptionText:
        "This is a full-time role for candidates with 0-1 years of experience. The role is remote in the United States.",
      officialUrl: "https://jobs.lever.co/policy-refresh/policy-early-career-1",
      applyUrl: "https://jobs.lever.co/policy-refresh/policy-early-career-1",
    };
    const context = {
      userId: user.id,
      companyId,
      companyDomain: "policy-refresh.test",
      sourceId,
      connectorKind: "lever" as const,
      tenantId: "policy-refresh",
      observedAt: new Date("2026-08-03T15:00:00Z"),
    };
    const ingest = await ingestListing(context, eligibleListing);
    const snapshot = await admin
      .from("job_description_snapshots")
      .select("id")
      .eq("job_id", ingest.jobId)
      .single();
    if (snapshot.error) throw snapshot.error;

    const decision = await admin
      .from("eligibility_decisions")
      .insert({
        user_id: user.id,
        job_id: ingest.jobId,
        snapshot_id: snapshot.data.id,
        outcome: "review",
        rule_version: "stale-rule",
        normalized_facts: {},
        reasons: [],
        evidence: [],
        uncertain_fields: ["stale"],
      })
      .select("id")
      .single();
    if (decision.error) throw decision.error;

    const cachedAnalysis = {
      employment: { value: "full_time", confidence: "high", evidence: [] },
      experienceRequirements: [],
      clearance: { value: "not_mentioned", confidence: "high", evidence: [] },
      publicTrust: { value: "not_mentioned", confidence: "high", evidence: [] },
      sponsorship: { value: "not_mentioned", confidence: "high", evidence: [] },
      workArrangement: { value: "fully_remote", confidence: "high", evidence: [] },
      locations: { value: ["United States"], confidence: "high", evidence: [] },
      roleFamily: { value: "general_swe", confidence: "high", evidence: [] },
      requiredSkills: ["TypeScript"],
      preferredSkills: [],
      candidateStrengths: ["Early-career experience alignment."],
      candidateWeaknesses: [],
      summary: "Early-career remote software engineering role.",
      extractionWarnings: [],
    };
    const analysis = await admin.from("ai_analyses").insert({
      user_id: user.id,
      job_id: ingest.jobId,
      snapshot_id: snapshot.data.id,
      status: "succeeded",
      model: "cached-test-model",
      schema_version: AI_ANALYSIS_SCHEMA_VERSION,
      prompt_hash: jobAnalysisPromptHash(),
      structured_output: cachedAnalysis,
    });
    if (analysis.error) throw analysis.error;
    const recommendation = await admin.from("recommendations").insert({
      user_id: user.id,
      job_id: ingest.jobId,
      snapshot_id: snapshot.data.id,
      eligibility_decision_id: decision.data.id,
      band: "review",
      urgency: 50,
      headline: "Stale recommendation",
      ranking_version: "stale-ranking",
    });
    if (recommendation.error) throw recommendation.error;

    const unchanged = await ingestListing(
      { ...context, observedAt: new Date("2026-08-03T16:00:00Z") },
      eligibleListing,
    );
    expect(unchanged.changed).toBe(false);
    const refreshed = await analyzeAndRankListing({
      userId: user.id,
      listing: eligibleListing,
      ingest: unchanged,
      hasReferral: false,
    });
    expect(refreshed).toMatchObject({ state: "analyzed", analysisStatus: "succeeded" });
    if (refreshed.state !== "analyzed") return;
    expect(refreshed.decision.outcome).toBe("eligible");

    const preserved = await admin
      .from("ai_analyses")
      .select("model,structured_output")
      .eq("snapshot_id", snapshot.data.id)
      .eq("schema_version", AI_ANALYSIS_SCHEMA_VERSION)
      .single();
    expect(preserved.error).toBeNull();
    expect(preserved.data?.model).toBe("cached-test-model");
    expect(preserved.data?.structured_output).toEqual(cachedAnalysis);

    const closed = await admin
      .from("canonical_jobs")
      .update({ lifecycle_status: "closed", closed_at: "2026-08-03T16:30:00Z" })
      .eq("id", ingest.jobId);
    if (closed.error) throw closed.error;
    const reopenedIngest = await ingestListing(
      { ...context, observedAt: new Date("2026-08-03T17:00:00Z") },
      eligibleListing,
    );
    expect(reopenedIngest).toMatchObject({ changed: false, reopened: true, snapshotId: null });
    const reopened = await analyzeAndRankListing({
      userId: user.id,
      listing: eligibleListing,
      ingest: reopenedIngest,
      hasReferral: false,
      now: new Date("2026-08-03T17:00:00Z"),
    });
    expect(reopened).toMatchObject({ state: "analyzed", analysisStatus: "succeeded" });
    const lifecycle = await admin
      .from("canonical_jobs")
      .select("lifecycle_status,reopened_at,posted_at")
      .eq("id", ingest.jobId)
      .single();
    expect(lifecycle.error).toBeNull();
    expect(lifecycle.data).toMatchObject({
      lifecycle_status: "reopened",
      reopened_at: "2026-08-03T17:00:00+00:00",
      posted_at: "2026-08-03T12:00:00+00:00",
    });
    const usage = await admin
      .from("usage_cost_ledger")
      .select("id")
      .eq("user_id", user.id)
      .eq("provider", "openai");
    expect(usage.data).toEqual([]);
  });
});
