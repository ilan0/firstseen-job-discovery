import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { candidateProfiles, searchPreferences } from "@/db/schema";
import type { RoleFamily } from "@/domain/eligibility";

const skillsSchema = z
  .object({
    languages: z.array(z.string()).default([]),
    frameworksAndData: z.array(z.string()).default([]),
    aiAndTools: z.array(z.string()).default([]),
  })
  .passthrough();

const rolePrioritySchema = z.object({
  family: z.enum([
    "general_swe",
    "full_stack",
    "backend",
    "frontend",
    "ai_engineering",
    "embedded",
    "internal_automation",
    "customer_facing",
    "other",
  ]),
  priority: z.number().int().min(1).max(20),
});

const acceptedAreaSchema = z
  .object({
    id: z.string().min(1),
    anchor: z.string().optional(),
    travelMinutes: z.number().int().positive().optional(),
    boroughs: z.array(z.string()).optional(),
    excludeStates: z.array(z.string()).optional(),
  })
  .passthrough();

export type CandidateRuntime = {
  userId: string;
  monthsFullTimeExperience: number;
  needsUsSponsorship: boolean;
  candidateSkills: string[];
  fullTimeOnly: boolean;
  idealRequiredYearsMax: number;
  eligibleRequiredYearsMax: number;
  rejectClearance: boolean;
  rejectPublicTrust: boolean;
  acceptedAreas: z.infer<typeof acceptedAreaSchema>[];
  allowFullyRemote: boolean;
  rolePriorities: Array<{ family: RoleFamily; priority: number }>;
};

export function parseCandidateRuntime(options: {
  userId: string;
  profile: {
    monthsFullTimeExperience: number;
    needsUsSponsorship: boolean;
    skills: unknown;
  };
  preferences: {
    fullTimeOnly: boolean;
    idealRequiredYearsMax: number;
    eligibleRequiredYearsMax: number;
    rejectClearance: boolean;
    rejectPublicTrust: boolean;
    acceptedAreas: unknown;
    allowFullyRemote: boolean;
    rolePriorities: unknown;
  };
}): CandidateRuntime {
  const skills = skillsSchema.parse(options.profile.skills);
  return {
    userId: options.userId,
    monthsFullTimeExperience: options.profile.monthsFullTimeExperience,
    needsUsSponsorship: options.profile.needsUsSponsorship,
    candidateSkills: [...skills.languages, ...skills.frameworksAndData, ...skills.aiAndTools],
    fullTimeOnly: options.preferences.fullTimeOnly,
    idealRequiredYearsMax: options.preferences.idealRequiredYearsMax,
    eligibleRequiredYearsMax: options.preferences.eligibleRequiredYearsMax,
    rejectClearance: options.preferences.rejectClearance,
    rejectPublicTrust: options.preferences.rejectPublicTrust,
    acceptedAreas: z.array(acceptedAreaSchema).parse(options.preferences.acceptedAreas),
    allowFullyRemote: options.preferences.allowFullyRemote,
    rolePriorities: z.array(rolePrioritySchema).parse(options.preferences.rolePriorities),
  };
}

export async function loadCandidateRuntime(userId: string): Promise<CandidateRuntime> {
  const [[profile], [preferences]] = await Promise.all([
    db
      .select({
        monthsFullTimeExperience: candidateProfiles.monthsFullTimeExperience,
        needsUsSponsorship: candidateProfiles.needsUsSponsorship,
        skills: candidateProfiles.skills,
      })
      .from(candidateProfiles)
      .where(eq(candidateProfiles.userId, userId))
      .limit(1),
    db
      .select({
        fullTimeOnly: searchPreferences.fullTimeOnly,
        idealRequiredYearsMax: searchPreferences.idealRequiredYearsMax,
        eligibleRequiredYearsMax: searchPreferences.eligibleRequiredYearsMax,
        rejectClearance: searchPreferences.rejectClearance,
        rejectPublicTrust: searchPreferences.rejectPublicTrust,
        acceptedAreas: searchPreferences.acceptedAreas,
        allowFullyRemote: searchPreferences.allowFullyRemote,
        rolePriorities: searchPreferences.rolePriorities,
      })
      .from(searchPreferences)
      .where(eq(searchPreferences.userId, userId))
      .limit(1),
  ]);
  if (!profile || !preferences)
    throw new Error("Candidate profile and search preferences must be configured before matching.");
  return parseCandidateRuntime({ userId, profile, preferences });
}
