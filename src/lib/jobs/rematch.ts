import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { NormalizedListing } from "@/connectors/types";
import { db } from "@/db/client";
import {
  canonicalJobs,
  careerSources,
  companies,
  jobDescriptionSnapshots,
  referrals,
} from "@/db/schema";
import type { IngestResult } from "./ingest";

const persistedFactsSchema = z.object({
  employmentType: z.string().nullable(),
  locations: z.array(z.string()),
  workplaceType: z.string().nullable(),
  salary: z.string().nullable(),
  applyUrl: z.string().url(),
  sourceFacts: z
    .object({
      employmentType: z.string().nullable(),
      locations: z.array(z.string()),
      workplaceType: z.string().nullable(),
      salaryText: z.string().nullable(),
      sourceConfidence: z.enum(["low", "medium", "high"]),
    })
    .optional(),
});

export type LegacyRematchTask = {
  userId: string;
  jobId: string;
  snapshotId: string;
};

export type LegacyPersonalizationTask = {
  listing: NormalizedListing;
  ingest: IngestResult;
  hasReferral: boolean;
  sourceConfidence: number;
};

export async function loadLegacyRematchTasks(
  userId: string,
  legacyOnly = false,
): Promise<LegacyRematchTask[]> {
  return db
    .select({
      userId: canonicalJobs.userId,
      jobId: canonicalJobs.id,
      snapshotId: jobDescriptionSnapshots.id,
    })
    .from(canonicalJobs)
    .innerJoin(
      jobDescriptionSnapshots,
      and(
        eq(jobDescriptionSnapshots.jobId, canonicalJobs.id),
        eq(jobDescriptionSnapshots.materialHash, canonicalJobs.currentMaterialHash),
      ),
    )
    .where(
      and(
        eq(canonicalJobs.userId, userId),
        inArray(canonicalJobs.lifecycleStatus, ["open", "reopened"]),
        ...(legacyOnly ? [isNull(canonicalJobs.globalJobId)] : []),
      ),
    );
}

export async function loadLegacyPersonalizationTask(
  task: LegacyRematchTask,
): Promise<LegacyPersonalizationTask | null> {
  const [row] = await db
    .select({
      jobId: canonicalJobs.id,
      title: canonicalJobs.title,
      externalId: canonicalJobs.externalJobId,
      requisitionId: canonicalJobs.requisitionId,
      officialUrl: canonicalJobs.officialUrl,
      postedAt: canonicalJobs.postedAt,
      postedAtConfidence: canonicalJobs.postedAtConfidence,
      firstSeenAt: canonicalJobs.firstSeenAt,
      reopenedAt: canonicalJobs.reopenedAt,
      lifecycleStatus: canonicalJobs.lifecycleStatus,
      descriptionText: jobDescriptionSnapshots.descriptionText,
      normalizedFacts: jobDescriptionSnapshots.normalizedFacts,
      parsingConfidence: careerSources.parsingConfidence,
      hasReferral: referrals.id,
    })
    .from(canonicalJobs)
    .innerJoin(companies, eq(companies.id, canonicalJobs.companyId))
    .innerJoin(careerSources, eq(careerSources.id, canonicalJobs.authoritativeSourceId))
    .innerJoin(
      jobDescriptionSnapshots,
      and(
        eq(jobDescriptionSnapshots.id, task.snapshotId),
        eq(jobDescriptionSnapshots.jobId, canonicalJobs.id),
        eq(jobDescriptionSnapshots.materialHash, canonicalJobs.currentMaterialHash),
      ),
    )
    .leftJoin(
      referrals,
      and(eq(referrals.userId, task.userId), eq(referrals.companyId, companies.id)),
    )
    .where(
      and(
        eq(canonicalJobs.id, task.jobId),
        eq(canonicalJobs.userId, task.userId),
        eq(companies.userId, task.userId),
        eq(careerSources.userId, task.userId),
        eq(companies.active, true),
        eq(careerSources.active, true),
        inArray(canonicalJobs.lifecycleStatus, ["open", "reopened"]),
      ),
    )
    .limit(1);
  if (!row) return null;
  const facts = persistedFactsSchema.safeParse(row.normalizedFacts);
  if (!facts.success) throw new Error("The persisted legacy listing facts are invalid.");
  const original = facts.data.sourceFacts;
  return {
    listing: {
      externalId: row.externalId,
      requisitionId: row.requisitionId,
      title: row.title,
      descriptionText: row.descriptionText,
      officialUrl: row.officialUrl,
      applyUrl: facts.data.applyUrl,
      locations: original?.locations ?? facts.data.locations,
      workplaceType: original?.workplaceType ?? facts.data.workplaceType,
      employmentType: original?.employmentType ?? facts.data.employmentType,
      postedAt: row.postedAt?.toISOString() ?? null,
      postedAtConfidence: row.postedAtConfidence,
      salaryText: original?.salaryText ?? facts.data.salary,
      sourceConfidence: original?.sourceConfidence ?? "high",
      rawMetadata: {},
    },
    ingest: {
      jobId: row.jobId,
      snapshotId: task.snapshotId,
      changed: false,
      firstSeenAt: row.firstSeenAt,
      postedAt: row.postedAt,
      postedAtConfidence: row.postedAtConfidence,
      postedAtAnomalous: false,
      reopenedAt: row.reopenedAt,
      reopened: row.lifecycleStatus === "reopened" && Boolean(row.reopenedAt),
    },
    hasReferral: Boolean(row.hasReferral),
    sourceConfidence: row.parsingConfidence,
  };
}
