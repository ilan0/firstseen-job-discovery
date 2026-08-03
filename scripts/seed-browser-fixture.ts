import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { NormalizedListing } from "@/connectors/types";

dotenv.config({ path: ".env.local", quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):/.test(url))
  throw new Error("Browser fixtures are local-only");
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY ?? "", {
  auth: { autoRefreshToken: false, persistSession: false },
});
const users = await admin.auth.admin.listUsers({ perPage: 100 });
if (users.error) throw users.error;
const owner = users.data.users.find(
  (user) => user.email?.toLowerCase() === process.env.OWNER_EMAIL?.toLowerCase(),
);
if (!owner) throw new Error("Owner not found");
await admin
  .from("companies")
  .delete()
  .eq("user_id", owner.id)
  .eq("normalized_name", "firstseen qa fixture");
const company = await admin
  .from("companies")
  .insert({
    user_id: owner.id,
    name: "FirstSeen QA Fixture",
    normalized_name: "firstseen qa fixture",
    domain: "qa.firstseen.local",
    origin: "referral",
    priority: 1,
  })
  .select("id")
  .single();
if (company.error) throw company.error;
const source = await admin
  .from("career_sources")
  .insert({
    user_id: owner.id,
    company_id: company.data.id,
    connector_kind: "lever",
    base_url: "https://jobs.lever.co/firstseen-qa",
    normalized_url: "https://jobs.lever.co/firstseen-qa",
    parsing_confidence: 95,
  })
  .select("id")
  .single();
if (source.error) throw source.error;
await admin.from("referrals").insert({
  user_id: owner.id,
  company_id: company.data.id,
  person_name: "QA Referral",
  status: "available",
});
const listing: NormalizedListing = {
  externalId: "qa-swe-1",
  requisitionId: "QA-1",
  title: "Software Engineer I",
  descriptionText:
    "This is a full-time hybrid Software Engineer role in Miami, Florida. Candidates must have 0-1 years of professional software engineering experience. TypeScript, React, PostgreSQL, and Python are required. AI API experience is preferred. No security clearance or Public Trust is required.",
  officialUrl: "https://jobs.lever.co/firstseen-qa/qa-swe-1",
  applyUrl: "https://jobs.lever.co/firstseen-qa/qa-swe-1/apply",
  locations: ["Miami, FL"],
  workplaceType: "Hybrid",
  employmentType: "Full-time",
  postedAt: new Date().toISOString(),
  postedAtConfidence: "high",
  salaryText: "$80,000-$100,000",
  sourceConfidence: "high",
  rawMetadata: { fixture: true },
};
const { ingestListing } = await import("@/lib/jobs/ingest");
const { analyzeAndRankListing } = await import("@/lib/jobs/analyze-and-rank");
const ingest = await ingestListing(
  {
    userId: owner.id,
    companyId: company.data.id,
    companyDomain: "qa.firstseen.local",
    sourceId: source.data.id,
    connectorKind: "lever",
    tenantId: "firstseen-qa",
    observedAt: new Date(),
  },
  listing,
);
const result = await analyzeAndRankListing({
  userId: owner.id,
  listing,
  ingest,
  hasReferral: true,
});
console.log(
  JSON.stringify({
    ok: true,
    jobId: ingest.jobId,
    recommendation: result.state === "analyzed" ? result.recommendation.band : result.state,
  }),
);
