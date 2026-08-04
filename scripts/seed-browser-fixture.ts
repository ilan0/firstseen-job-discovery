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
    interested: true,
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
    public_config: { fixture: "browser", networkDisabled: true },
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
const personalWatch = await admin.from("watchlists").insert({
  user_id: owner.id,
  company_id: company.data.id,
  scope: "personal",
  monitoring_tier: "priority",
  cadence_minutes: 15,
});
if (personalWatch.error) throw personalWatch.error;
await admin
  .from("companies")
  .delete()
  .eq("user_id", owner.id)
  .eq("normalized_name", "firstseen qa discovery");
const discoveredCompany = await admin
  .from("companies")
  .insert({
    user_id: owner.id,
    name: "FirstSeen QA Discovery",
    normalized_name: "firstseen qa discovery",
    origin: "discovered",
    priority: 4,
    discovery_evidence: {
      sensor: "brave",
      discoveredAt: new Date().toISOString(),
      titleHint: "Junior Software Engineer",
    },
  })
  .select("id")
  .single();
if (discoveredCompany.error) throw discoveredCompany.error;
const discoveredSource = await admin.from("career_sources").insert({
  user_id: owner.id,
  company_id: discoveredCompany.data.id,
  connector_kind: "ashby",
  base_url: "https://jobs.ashbyhq.com/firstseen-qa-discovery",
  normalized_url: "https://jobs.ashbyhq.com/firstseen-qa-discovery",
  parsing_confidence: 90,
  public_config: { fixture: "browser", networkDisabled: true },
});
if (discoveredSource.error) throw discoveredSource.error;
const discoveredWatch = await admin.from("watchlists").insert({
  user_id: owner.id,
  company_id: discoveredCompany.data.id,
  scope: "discovered",
  monitoring_tier: "cold",
  cadence_minutes: 240,
});
if (discoveredWatch.error) throw discoveredWatch.error;
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
  sharedExtraction: {
    status: "succeeded",
    model: "browser-fixture",
    errorCode: null,
    unresolvedFields: [],
    analysis: {
      employment: { value: "full_time", confidence: "high", evidence: [] },
      experienceRequirements: [
        {
          text: "0-1 years of professional software engineering experience",
          kind: "required",
          minimumYears: 0,
          maximumYears: 1,
          alternativePath: false,
          confidence: "high",
          evidence: [],
        },
      ],
      clearance: { value: "not_required", confidence: "high", evidence: [] },
      publicTrust: { value: "not_required", confidence: "high", evidence: [] },
      sponsorship: { value: "not_mentioned", confidence: "high", evidence: [] },
      workArrangement: { value: "hybrid", confidence: "high", evidence: [] },
      locations: { value: ["Miami, FL"], confidence: "high", evidence: [] },
      roleFamily: { value: "general_swe", confidence: "high", evidence: [] },
      requiredSkills: ["TypeScript", "React", "PostgreSQL", "Python"],
      preferredSkills: ["AI API experience"],
      candidateStrengths: [],
      candidateWeaknesses: [],
      summary: "Early-career hybrid software engineering role in Miami.",
      extractionWarnings: [],
    },
  },
});
console.log(
  JSON.stringify({
    ok: true,
    jobId: ingest.jobId,
    recommendation: result.state === "analyzed" ? result.recommendation.band : result.state,
  }),
);
