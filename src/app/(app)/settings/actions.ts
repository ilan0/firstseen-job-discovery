"use server";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import {
  candidateProfiles,
  outboxEvents,
  recommendations,
  resumeVersions,
  searchPreferences,
  storageCleanupRecords,
  userRecommendations,
} from "@/db/schema";
import { inngest } from "@/inngest/client";
import { requireOwner } from "@/lib/auth/owner";
import { RESUME_BUCKET } from "@/domain/applications/resume";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { processStorageCleanupRecords } from "@/lib/maintenance/storage-cleanup";
const feedPreferenceSchema = z.object({
  defaultPostedWindow: z.enum(["6h", "24h", "3d", "7d", "30d", "all"]),
  defaultFeedSort: z.enum(["posted_newest", "detected_newest", "urgency"]),
});
export async function updateFeedPreferences(formData: FormData) {
  const owner = await requireOwner();
  const value = feedPreferenceSchema.parse({
    defaultPostedWindow: formData.get("defaultPostedWindow"),
    defaultFeedSort: formData.get("defaultFeedSort"),
  });
  await db
    .update(searchPreferences)
    .set({
      defaultPostedWindow: value.defaultPostedWindow,
      defaultFeedSort: value.defaultFeedSort,
      preferencesVersion: sql`${searchPreferences.preferencesVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(searchPreferences.userId, owner.id));
  revalidatePath("/settings");
  redirect("/settings?saved=feed");
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
  const requestedAt = new Date();
  const rematchId = randomUUID();
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
        // Keep the separate detector internally, but expose one clearance preference.
        rejectPublicTrust: Boolean(input.rejectClearance),
        acceptedAreas,
        allowFullyRemote: Boolean(input.allowRemote),
        rolePriorities,
        preferencesVersion: sql`${searchPreferences.preferencesVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(searchPreferences.userId, owner.id));
    // Runtime matching is profile-driven. Invalidate the old personalized
    // projections so an unchanged official description is still reevaluated.
    await tx
      .update(recommendations)
      .set({ active: false, updatedAt: requestedAt })
      .where(eq(recommendations.userId, owner.id));
    await tx
      .update(userRecommendations)
      .set({ active: false, updatedAt: requestedAt })
      .where(eq(userRecommendations.userId, owner.id));
    await tx.insert(outboxEvents).values({
      id: rematchId,
      userId: owner.id,
      eventName: "supply/user.rematch.requested.v2",
      aggregateType: "candidate_profile",
      aggregateId: owner.id,
      idempotencyKey: `user-rematch:${rematchId}`,
      payload: { userId: owner.id, requestedAt: requestedAt.toISOString() },
    });
  });
  try {
    await inngest.send({
      id: rematchId,
      name: "supply/user.rematch.requested.v2",
      data: { userId: owner.id, requestedAt: requestedAt.toISOString() },
    });
    await db
      .update(outboxEvents)
      .set({ status: "dispatched", dispatchedAt: new Date(), updatedAt: new Date() })
      .where(eq(outboxEvents.id, rematchId));
  } catch {
    // The committed outbox record is retried by the durable scheduler. A
    // settings update must not fail merely because Inngest is temporarily down.
  }
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
  const cleanupRecords = resumePaths.length
    ? await db
        .insert(storageCleanupRecords)
        .values(
          resumePaths.map((resume) => ({
            bucket: RESUME_BUCKET,
            objectPath: resume.path,
            reason: "account_deletion",
            status: "waiting",
          })),
        )
        .onConflictDoUpdate({
          target: [storageCleanupRecords.bucket, storageCleanupRecords.objectPath],
          set: { status: "waiting", lastErrorCode: null, updatedAt: new Date() },
        })
        .returning({ id: storageCleanupRecords.id })
    : [];
  const cleanupIds = cleanupRecords.map((record) => record.id);
  const { error } = await admin.auth.admin.deleteUser(owner.id);
  if (error) {
    if (cleanupIds.length)
      await db.delete(storageCleanupRecords).where(inArray(storageCleanupRecords.id, cleanupIds));
    throw new Error("Account deletion failed. No data was intentionally removed.");
  }
  if (cleanupIds.length) {
    await db
      .update(storageCleanupRecords)
      .set({ status: "pending", nextAttemptAt: new Date(), updatedAt: new Date() })
      .where(inArray(storageCleanupRecords.id, cleanupIds));
    await processStorageCleanupRecords({ ids: cleanupIds });
  }
  const session = await createSupabaseServerClient();
  await session.auth.signOut();
  redirect("/sign-in?deleted=1");
}
