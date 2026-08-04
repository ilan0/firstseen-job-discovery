"use server";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { candidateProfiles, resumeVersions, searchPreferences } from "@/db/schema";
import { requireOwner } from "@/lib/auth/owner";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
const schema = z.object({
  digestEnabled: z.enum(["on"]).optional(),
  alertsEnabled: z.enum(["on"]).optional(),
  digestHour: z.coerce.number().int().min(0).max(23),
  defaultPostedWindow: z.enum(["6h", "24h", "3d", "7d", "30d", "all"]),
  defaultFeedSort: z.enum(["posted_newest", "detected_newest", "urgency"]),
});
export async function updateNotifications(formData: FormData) {
  const owner = await requireOwner();
  const value = schema.parse({
    digestEnabled: formData.get("digestEnabled") ?? undefined,
    alertsEnabled: formData.get("alertsEnabled") ?? undefined,
    digestHour: formData.get("digestHour"),
    defaultPostedWindow: formData.get("defaultPostedWindow"),
    defaultFeedSort: formData.get("defaultFeedSort"),
  });
  await db
    .update(searchPreferences)
    .set({
      digestEnabled: Boolean(value.digestEnabled),
      exceptionalAlertsEnabled: Boolean(value.alertsEnabled),
      digestHourLocal: value.digestHour,
      defaultPostedWindow: value.defaultPostedWindow,
      defaultFeedSort: value.defaultFeedSort,
      preferencesVersion: sql`${searchPreferences.preferencesVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(searchPreferences.userId, owner.id));
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

const roleFamilies = [
  "general_swe",
  "full_stack",
  "backend",
  "frontend",
  "ai_engineering",
  "embedded",
  "internal_automation",
  "customer_facing",
] as const;

const candidateSettingsSchema = z.object({
  monthsExperience: z.coerce.number().int().min(0).max(600),
  needsSponsorship: z.enum(["on"]).optional(),
  fullTimeOnly: z.enum(["on"]).optional(),
  idealYearsMax: z.coerce.number().int().min(0).max(20),
  eligibleYearsMax: z.coerce.number().int().min(0).max(20),
  rejectClearance: z.enum(["on"]).optional(),
  rejectPublicTrust: z.enum(["on"]).optional(),
  allowRemote: z.enum(["on"]).optional(),
  southFlorida: z.enum(["on"]).optional(),
  dmv: z.enum(["on"]).optional(),
  nyc: z.enum(["on"]).optional(),
  skills: z.string().max(10_000),
});

export async function updateCandidateSettings(formData: FormData) {
  const owner = await requireOwner();
  const input = candidateSettingsSchema.parse({
    monthsExperience: formData.get("monthsExperience"),
    needsSponsorship: formData.get("needsSponsorship") ?? undefined,
    fullTimeOnly: formData.get("fullTimeOnly") ?? undefined,
    idealYearsMax: formData.get("idealYearsMax"),
    eligibleYearsMax: formData.get("eligibleYearsMax"),
    rejectClearance: formData.get("rejectClearance") ?? undefined,
    rejectPublicTrust: formData.get("rejectPublicTrust") ?? undefined,
    allowRemote: formData.get("allowRemote") ?? undefined,
    southFlorida: formData.get("southFlorida") ?? undefined,
    dmv: formData.get("dmv") ?? undefined,
    nyc: formData.get("nyc") ?? undefined,
    skills: formData.get("skills"),
  });
  if (input.idealYearsMax > input.eligibleYearsMax)
    throw new Error("Ideal experience cannot exceed the eligible maximum.");
  const acceptedAreas = [
    input.southFlorida ? { id: "south-florida", anchor: "Miami, FL", travelMinutes: 60 } : null,
    input.dmv ? { id: "dmv", anchor: "Fairfax, VA", travelMinutes: 60 } : null,
    input.nyc
      ? {
          id: "nyc",
          boroughs: ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"],
          excludeStates: ["NJ"],
        }
      : null,
  ].filter((area): area is NonNullable<typeof area> => area !== null);
  if (!acceptedAreas.length && !input.allowRemote)
    throw new Error("Choose at least one accepted area or fully remote work.");
  const rolePriorities = roleFamilies
    .map((family) => ({
      family,
      priority: z.coerce
        .number()
        .int()
        .min(1)
        .max(20)
        .parse(formData.get(`priority-${family}`)),
    }))
    .toSorted((left, right) => left.priority - right.priority);
  const skills = [
    ...new Set(
      input.skills
        .split(/[,\n]/)
        .map((skill) => skill.trim())
        .filter(Boolean),
    ),
  ];
  await db.transaction(async (tx) => {
    await tx
      .update(candidateProfiles)
      .set({
        monthsFullTimeExperience: input.monthsExperience,
        needsUsSponsorship: Boolean(input.needsSponsorship),
        skills: { languages: skills, frameworksAndData: [], aiAndTools: [] },
        profileVersion: sql`${candidateProfiles.profileVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(candidateProfiles.userId, owner.id));
    await tx
      .update(searchPreferences)
      .set({
        fullTimeOnly: Boolean(input.fullTimeOnly),
        idealRequiredYearsMax: input.idealYearsMax,
        eligibleRequiredYearsMax: input.eligibleYearsMax,
        rejectClearance: Boolean(input.rejectClearance),
        rejectPublicTrust: Boolean(input.rejectPublicTrust),
        acceptedAreas,
        allowFullyRemote: Boolean(input.allowRemote),
        rolePriorities,
        preferencesVersion: sql`${searchPreferences.preferencesVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(searchPreferences.userId, owner.id));
  });
  revalidatePath("/");
  revalidatePath("/settings");
  redirect("/settings?saved=profile");
}

export async function deleteAccount(formData: FormData) {
  const owner = await requireOwner();
  z.literal("DELETE FIRSTSEEN").parse(formData.get("confirmation"));
  const admin = createSupabaseAdminClient();
  const resumePaths = await db
    .select({ path: resumeVersions.storagePath })
    .from(resumeVersions)
    .where(eq(resumeVersions.userId, owner.id));
  const { error } = await admin.auth.admin.deleteUser(owner.id);
  if (error) throw new Error("Account deletion failed. No data was intentionally removed.");
  if (resumePaths.length)
    await admin.storage.from("resumes").remove(resumePaths.map((resume) => resume.path));
  const session = await createSupabaseServerClient();
  await session.auth.signOut();
  redirect("/sign-in?deleted=1");
}
