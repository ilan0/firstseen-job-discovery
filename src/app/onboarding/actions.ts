"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { candidateProfiles, searchPreferences } from "@/db/schema";
import { requireOwner } from "@/lib/auth/owner";

const schema = z.object({
  fullName: z.string().trim().min(2).max(160),
  headline: z.string().trim().min(2).max(200),
  homeCity: z.string().trim().min(2).max(160),
  homeRegion: z.string().trim().min(2).max(160),
  monthsExperience: z.coerce.number().int().min(0).max(600),
  needsSponsorship: z.enum(["on"]).optional(),
  skills: z.string().max(10_000),
});

export async function completeOnboarding(formData: FormData) {
  const user = await requireOwner();
  const input = schema.parse({
    ...Object.fromEntries(formData),
    needsSponsorship: formData.get("needsSponsorship") ?? undefined,
  });
  const skills = [
    ...new Set(
      input.skills
        .split(/[,\n]/)
        .map((skill) => skill.trim())
        .filter(Boolean),
    ),
  ];
  await db.transaction(async (tx) => {
    await tx.insert(candidateProfiles).values({
      userId: user.id,
      fullName: input.fullName,
      headline: input.headline,
      homeCity: input.homeCity,
      homeRegion: input.homeRegion,
      monthsFullTimeExperience: input.monthsExperience,
      needsUsSponsorship: Boolean(input.needsSponsorship),
      summary: input.headline,
      skills: { languages: skills, frameworksAndData: [], aiAndTools: [] },
    });
    await tx.insert(searchPreferences).values({
      userId: user.id,
      acceptedAreas: [],
      allowFullyRemote: true,
      rolePriorities: [
        { family: "general_swe", priority: 1 },
        { family: "full_stack", priority: 2 },
        { family: "backend", priority: 3 },
        { family: "frontend", priority: 4 },
        { family: "ai_engineering", priority: 5 },
        { family: "embedded", priority: 6 },
        { family: "internal_automation", priority: 7 },
        { family: "customer_facing", priority: 8 },
      ],
    });
  });
  redirect("/settings?saved=profile");
}
