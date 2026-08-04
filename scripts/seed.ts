import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { candidateSeed, preferenceSeed } from "../src/config/candidate";
import {
  detectResumeMime,
  MAX_RESUME_BYTES,
  RESUME_BUCKET,
  safeResumeFilename,
} from "../src/domain/applications/resume";

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

const resumePath = process.argv[2];
const resumeBytes = resumePath ? new Uint8Array(readFileSync(resumePath)) : null;
if (resumeBytes && (resumeBytes.byteLength < 1 || resumeBytes.byteLength > MAX_RESUME_BYTES))
  throw new Error("Optional seed resume must be between 1 byte and 5 MB.");
const resumeMime = resumeBytes ? detectResumeMime(resumeBytes) : null;
if (resumeBytes && !resumeMime)
  throw new Error("Optional seed resume is not a genuine PDF/DOC/DOCX.");
const resumeSourceHash = resumeBytes
  ? createHash("sha256").update(resumeBytes).digest("hex")
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

if (resumePath && resumeBytes && resumeMime && resumeSourceHash) {
  const filename = safeResumeFilename(basename(resumePath));
  const storagePath = `${owner.id}/seed-${resumeSourceHash.slice(0, 16)}-${filename}`;
  const { error: uploadError } = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(storagePath, resumeBytes, { contentType: resumeMime, upsert: true });
  if (uploadError) throw uploadError;
  const { error: resumeError } = await supabase.from("resume_versions").upsert(
    {
      user_id: owner.id,
      label: "Seed resume",
      storage_path: storagePath,
      source_hash: resumeSourceHash,
      mime_type: resumeMime,
      original_filename: filename,
      size_bytes: resumeBytes.byteLength,
      active: true,
    },
    { onConflict: "user_id,source_hash" },
  );
  if (resumeError) throw resumeError;
}

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
