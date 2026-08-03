import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { candidateSeed, preferenceSeed } from "../src/config/candidate";

dotenv.config({ path: ".env.local", quiet: true });

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key}; run pnpm env:local first.`);
  return value;
}

const supabase = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SECRET_KEY"),
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

const email = required("OWNER_EMAIL");
const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ perPage: 100 });
if (listError) throw listError;
const owner = listed.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
if (!owner) throw new Error("Local owner does not exist; run pnpm db:owner first.");

const resumePath = "/Users/ilannabatkhorian/Downloads/Ilan_Nabatkhorian_Resume.pdf";
const resumeSourceHash = existsSync(resumePath)
  ? createHash("sha256").update(readFileSync(resumePath)).digest("hex")
  : null;

const { error: profileError } = await supabase.from("candidate_profiles").upsert(
  {
    user_id: owner.id,
    full_name: candidateSeed.fullName,
    headline: candidateSeed.headline,
    home_city: candidateSeed.homeCity,
    home_region: candidateSeed.homeRegion,
    months_full_time_experience: candidateSeed.monthsFullTimeExperience,
    needs_us_sponsorship: candidateSeed.needsUsSponsorship,
    citizenships: candidateSeed.citizenships,
    summary: candidateSeed.summary,
    education: candidateSeed.education,
    work_history: candidateSeed.workHistory,
    skills: candidateSeed.skills,
    resume_source_hash: resumeSourceHash,
    profile_version: 1,
  },
  { onConflict: "user_id" },
);
if (profileError) throw profileError;

const { error: preferencesError } = await supabase.from("search_preferences").upsert(
  {
    user_id: owner.id,
    ...Object.fromEntries(
      Object.entries(preferenceSeed).map(([key, value]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        value,
      ]),
    ),
    digest_enabled: true,
    exceptional_alerts_enabled: true,
    preferences_version: 1,
  },
  { onConflict: "user_id" },
);
if (preferencesError) throw preferencesError;

console.log("Candidate profile and deterministic search preferences seeded.");
