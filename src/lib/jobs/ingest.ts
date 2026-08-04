import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { NormalizedListing } from "@/connectors/types";
import type { ConnectorKind } from "@/connectors/versions";
import { db } from "@/db/client";
import {
  canonicalJobs,
  dedupeFingerprints,
  jobDescriptionSnapshots,
  jobSourceLinks,
  rawObservations,
} from "@/db/schema";
import {
  jobFingerprints,
  materialChangeReasons,
  materialFields,
  materialHash,
  normalizeOfficialUrl,
  normalizeTitle,
} from "@/domain/jobs";

export type IngestContext = {
  userId: string;
  companyId: string;
  companyDomain: string;
  sourceId: string;
  connectorKind: ConnectorKind;
  tenantId: string | null;
  observedAt: Date;
  scanSourceRunId?: string | null;
};
export type IngestResult = {
  jobId: string;
  snapshotId: string | null;
  changed: boolean;
  firstSeenAt: Date;
};

function date(value: string | null): Date | null {
  if (!value) return null;
  const result = new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
}
function employment(
  value: string | null,
): "full_time" | "part_time" | "contract" | "internship" | "temporary" | "unknown" {
  const text = value?.toLowerCase() ?? "";
  if (/full.?time/.test(text)) return "full_time";
  if (/part.?time/.test(text)) return "part_time";
  if (/contract/.test(text)) return "contract";
  if (/intern/.test(text)) return "internship";
  if (/temporary|temp/.test(text)) return "temporary";
  return "unknown";
}

export async function ingestListing(
  context: IngestContext,
  listing: NormalizedListing,
): Promise<IngestResult> {
  const normalizedUrl = normalizeOfficialUrl(listing.officialUrl);
  const hash = materialHash(listing);
  const fields = materialFields(listing);
  const fingerprints = jobFingerprints({
    connectorKind: context.connectorKind,
    tenantId: context.tenantId,
    companyDomain: context.companyDomain,
    listing,
  });
  return db.transaction(async (tx) => {
    const [existingFingerprint] = await tx
      .select({ jobId: dedupeFingerprints.jobId })
      .from(dedupeFingerprints)
      .where(
        and(
          eq(dedupeFingerprints.userId, context.userId),
          eq(dedupeFingerprints.active, true),
          inArray(
            dedupeFingerprints.fingerprint,
            fingerprints.filter((item) => item.confidence >= 90).map((item) => item.fingerprint),
          ),
        ),
      )
      .limit(1);
    let jobId = existingFingerprint?.jobId;
    let firstSeenAt = context.observedAt;
    if (!jobId) {
      const [job] = await tx
        .insert(canonicalJobs)
        .values({
          userId: context.userId,
          companyId: context.companyId,
          authoritativeSourceId: context.sourceId,
          externalJobId: listing.externalId,
          requisitionId: listing.requisitionId,
          title: listing.title,
          normalizedTitle: normalizeTitle(listing.title),
          employmentType: employment(listing.employmentType),
          officialUrl: listing.officialUrl,
          normalizedOfficialUrl: normalizedUrl,
          lifecycleStatus: "open",
          postedAt: date(listing.postedAt),
          postedAtConfidence: listing.postedAtConfidence,
          firstSeenAt: context.observedAt,
          verifiedAt: context.observedAt,
          lastSeenAt: context.observedAt,
        })
        .onConflictDoUpdate({
          target: [canonicalJobs.userId, canonicalJobs.normalizedOfficialUrl],
          set: {
            title: listing.title,
            normalizedTitle: normalizeTitle(listing.title),
            employmentType: employment(listing.employmentType),
            lifecycleStatus: "open",
            externalJobId: listing.externalId,
            requisitionId: listing.requisitionId,
            postedAt: date(listing.postedAt),
            postedAtConfidence: listing.postedAtConfidence,
            verifiedAt: context.observedAt,
            lastSeenAt: context.observedAt,
            updatedAt: new Date(),
          },
        })
        .returning({ id: canonicalJobs.id, firstSeenAt: canonicalJobs.firstSeenAt });
      if (!job) throw new Error("Canonical job could not be persisted");
      jobId = job.id;
      firstSeenAt = job.firstSeenAt;
    } else {
      const [job] = await tx
        .update(canonicalJobs)
        .set({
          title: listing.title,
          normalizedTitle: normalizeTitle(listing.title),
          employmentType: employment(listing.employmentType),
          officialUrl: listing.officialUrl,
          normalizedOfficialUrl: normalizedUrl,
          lifecycleStatus: "open",
          externalJobId: listing.externalId,
          requisitionId: listing.requisitionId,
          postedAt: date(listing.postedAt),
          postedAtConfidence: listing.postedAtConfidence,
          verifiedAt: context.observedAt,
          lastSeenAt: context.observedAt,
          updatedAt: new Date(),
        })
        .where(and(eq(canonicalJobs.userId, context.userId), eq(canonicalJobs.id, jobId)))
        .returning({ firstSeenAt: canonicalJobs.firstSeenAt });
      firstSeenAt = job?.firstSeenAt ?? firstSeenAt;
    }
    const [current] = await tx
      .select({ materialHash: canonicalJobs.currentMaterialHash })
      .from(canonicalJobs)
      .where(eq(canonicalJobs.id, jobId))
      .limit(1);
    const changed = current?.materialHash !== hash;
    const [observation] = await tx
      .insert(rawObservations)
      .values({
        userId: context.userId,
        scanSourceRunId: context.scanSourceRunId ?? null,
        careerSourceId: context.sourceId,
        externalJobId: listing.externalId,
        officialUrl: listing.officialUrl,
        observedAt: context.observedAt,
        status: current?.materialHash ? (changed ? "changed" : "unchanged") : "verified",
        contentType: "application/normalized+json",
        contentHash: hash,
        responseMetadata: listing.rawMetadata,
        normalizedPayload: { ...fields, applyUrl: listing.applyUrl },
        sanitizedBody: listing.descriptionText.slice(0, 100_000),
        expiresAt: new Date(context.observedAt.getTime() + 30 * 86_400_000),
      })
      .returning({ id: rawObservations.id });
    let snapshotId: string | null = null;
    if (changed) {
      const [previous] = await tx
        .select({ facts: jobDescriptionSnapshots.normalizedFacts })
        .from(jobDescriptionSnapshots)
        .where(eq(jobDescriptionSnapshots.jobId, jobId))
        .orderBy(desc(jobDescriptionSnapshots.capturedAt))
        .limit(1);
      const [snapshot] = await tx
        .insert(jobDescriptionSnapshots)
        .values({
          userId: context.userId,
          jobId,
          observationId: observation?.id ?? null,
          materialHash: hash,
          descriptionText: listing.descriptionText,
          normalizedFacts: fields,
          materialChangeReasons: materialChangeReasons(
            (previous?.facts as ReturnType<typeof materialFields> | undefined) ?? null,
            fields,
          ),
          capturedAt: context.observedAt,
        })
        .onConflictDoNothing()
        .returning({ id: jobDescriptionSnapshots.id });
      if (snapshot) snapshotId = snapshot.id;
      else {
        const [existing] = await tx
          .select({ id: jobDescriptionSnapshots.id })
          .from(jobDescriptionSnapshots)
          .where(
            and(
              eq(jobDescriptionSnapshots.jobId, jobId),
              eq(jobDescriptionSnapshots.materialHash, hash),
            ),
          )
          .limit(1);
        snapshotId = existing?.id ?? null;
      }
      await tx
        .update(canonicalJobs)
        .set({
          currentMaterialHash: hash,
          rowVersion: sql`${canonicalJobs.rowVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(canonicalJobs.id, jobId));
    }
    await tx
      .insert(jobSourceLinks)
      .values({
        userId: context.userId,
        jobId,
        careerSourceId: context.sourceId,
        externalJobId: listing.externalId,
        sourceUrl: listing.officialUrl,
        authoritative: true,
        lastSeenAt: context.observedAt,
      })
      .onConflictDoUpdate({
        target: [jobSourceLinks.jobId, jobSourceLinks.careerSourceId],
        set: {
          externalJobId: listing.externalId,
          sourceUrl: listing.officialUrl,
          lastSeenAt: context.observedAt,
          authoritative: true,
          updatedAt: new Date(),
        },
      });
    for (const item of fingerprints)
      await tx
        .insert(dedupeFingerprints)
        .values({
          userId: context.userId,
          jobId,
          kind: item.kind,
          fingerprint: item.fingerprint,
          confidence: item.confidence,
        })
        .onConflictDoUpdate({
          target: [
            dedupeFingerprints.userId,
            dedupeFingerprints.kind,
            dedupeFingerprints.fingerprint,
          ],
          set: { active: true, updatedAt: new Date() },
        });
    return { jobId, snapshotId, changed, firstSeenAt };
  });
}
