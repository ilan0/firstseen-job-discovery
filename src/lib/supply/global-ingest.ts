import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { NormalizedListing } from "@/connectors/types";
import type { ConnectorKind } from "@/connectors/versions";
import { db } from "@/db/client";
import {
  globalJobFingerprints,
  globalJobLifecycleEvents,
  globalJobSnapshots,
  globalJobSourceLinks,
  globalJobs,
  globalRawObservations,
  coverageBenchmarks,
} from "@/db/schema";
import {
  jobFingerprints,
  materialChangeReasons,
  materialFields,
  materialHash,
  normalizeOfficialUrl,
  normalizePostedTimestamp,
  normalizeTitle,
} from "@/domain/jobs";
import { coverageUrlHash } from "@/lib/coverage/identity";

export type GlobalIngestContext = {
  organizationId: string;
  organizationDomain: string;
  sourceId: string;
  connectorKind: ConnectorKind;
  tenantId: string | null;
  observedAt: Date;
  scanRunId?: string | null;
};

export type GlobalIngestResult = {
  jobId: string;
  snapshotId: string;
  changed: boolean;
  reopened: boolean;
  firstSeenAt: Date;
  postedAt: Date | null;
  postedAtConfidence: "low" | "medium" | "high";
  reopenedAt: Date | null;
};

function parsedDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Persists candidate-neutral official supply exactly once. The caller performs
 * all network work before entering this function, so the transaction never
 * spans a provider or model request.
 */
export async function ingestGlobalListing(
  context: GlobalIngestContext,
  listing: NormalizedListing,
): Promise<GlobalIngestResult> {
  const normalizedUrl = normalizeOfficialUrl(listing.officialUrl);
  const normalizedPosted = normalizePostedTimestamp(
    listing.postedAt,
    listing.postedAtConfidence,
    context.observedAt,
  );
  const postedAt = parsedDate(normalizedPosted.postedAt);
  const hash = materialHash(listing);
  const fields = materialFields(listing);
  const fingerprints = jobFingerprints({
    connectorKind: context.connectorKind,
    tenantId: context.tenantId,
    companyDomain: context.organizationDomain,
    listing,
  });
  const strongFingerprints = fingerprints
    .filter((fingerprint) => fingerprint.confidence >= 90)
    .map((fingerprint) => fingerprint.fingerprint);

  return db.transaction(async (tx) => {
    const [byFingerprint] = strongFingerprints.length
      ? await tx
          .select({
            id: globalJobs.id,
            lifecycleStatus: globalJobs.lifecycleStatus,
          })
          .from(globalJobFingerprints)
          .innerJoin(globalJobs, eq(globalJobFingerprints.jobId, globalJobs.id))
          .where(
            and(
              eq(globalJobFingerprints.active, true),
              inArray(globalJobFingerprints.fingerprint, strongFingerprints),
            ),
          )
          .limit(1)
      : [];
    const [byUrl] = byFingerprint
      ? []
      : await tx
          .select({
            id: globalJobs.id,
            lifecycleStatus: globalJobs.lifecycleStatus,
          })
          .from(globalJobs)
          .where(eq(globalJobs.normalizedOfficialUrl, normalizedUrl))
          .limit(1);
    const existing = byFingerprint ?? byUrl;
    const previousStatus = existing?.lifecycleStatus ?? null;
    const reopened = previousStatus === "closed" || previousStatus === "possibly_closed";
    const nextStatus = reopened || previousStatus === "reopened" ? "reopened" : "open";

    const [job] = existing
      ? await tx
          .update(globalJobs)
          .set({
            organizationId: context.organizationId,
            authoritativeSourceId: context.sourceId,
            externalJobId: listing.externalId,
            requisitionId: listing.requisitionId,
            title: listing.title,
            normalizedTitle: normalizeTitle(listing.title),
            officialUrl: listing.officialUrl,
            normalizedOfficialUrl: normalizedUrl,
            applyUrl: listing.applyUrl,
            lifecycleStatus: nextStatus,
            postedAt: postedAt ?? globalJobs.postedAt,
            postedAtConfidence: postedAt
              ? normalizedPosted.confidence
              : globalJobs.postedAtConfidence,
            verifiedAt: context.observedAt,
            lastSeenAt: context.observedAt,
            possiblyClosedAt: null,
            closedAt: null,
            reopenedAt: reopened ? context.observedAt : globalJobs.reopenedAt,
            consecutiveSuccessfulMisses: 0,
            updatedAt: context.observedAt,
          })
          .where(eq(globalJobs.id, existing.id))
          .returning()
      : await tx
          .insert(globalJobs)
          .values({
            organizationId: context.organizationId,
            authoritativeSourceId: context.sourceId,
            externalJobId: listing.externalId,
            requisitionId: listing.requisitionId,
            title: listing.title,
            normalizedTitle: normalizeTitle(listing.title),
            officialUrl: listing.officialUrl,
            normalizedOfficialUrl: normalizedUrl,
            applyUrl: listing.applyUrl,
            lifecycleStatus: "open",
            postedAt,
            postedAtConfidence: normalizedPosted.confidence,
            firstSeenAt: context.observedAt,
            verifiedAt: context.observedAt,
            lastSeenAt: context.observedAt,
          })
          .onConflictDoUpdate({
            target: globalJobs.normalizedOfficialUrl,
            set: {
              verifiedAt: context.observedAt,
              lastSeenAt: context.observedAt,
              updatedAt: context.observedAt,
            },
          })
          .returning();
    if (!job) throw new Error("Global canonical job could not be persisted");

    const changed = job.currentMaterialHash !== hash;
    const [observation] = await tx
      .insert(globalRawObservations)
      .values({
        scanRunId: context.scanRunId ?? null,
        careerSourceId: context.sourceId,
        externalJobId: listing.externalId,
        officialUrl: listing.officialUrl,
        observedAt: context.observedAt,
        status: job.currentMaterialHash ? (changed ? "changed" : "unchanged") : "verified",
        contentHash: hash,
        normalizedPayload: { ...fields, applyUrl: listing.applyUrl },
        sanitizedBody: changed ? listing.descriptionText.slice(0, 100_000) : null,
        responseMetadata: listing.rawMetadata,
        expiresAt: new Date(context.observedAt.getTime() + 30 * 86_400_000),
      })
      .onConflictDoNothing()
      .returning({ id: globalRawObservations.id });

    let snapshotId = job.currentSnapshotId;
    if (changed || !snapshotId) {
      const [previous] = await tx
        .select({ facts: globalJobSnapshots.normalizedFacts })
        .from(globalJobSnapshots)
        .where(eq(globalJobSnapshots.jobId, job.id))
        .orderBy(desc(globalJobSnapshots.capturedAt))
        .limit(1);
      const [created] = await tx
        .insert(globalJobSnapshots)
        .values({
          jobId: job.id,
          observationId: observation?.id ?? null,
          materialHash: hash,
          descriptionText: listing.descriptionText,
          normalizedFacts: fields,
          materialChangeReasons: previous?.facts
            ? materialChangeReasons(previous.facts as ReturnType<typeof materialFields>, fields)
            : [],
          capturedAt: context.observedAt,
        })
        .onConflictDoNothing()
        .returning({ id: globalJobSnapshots.id });
      snapshotId =
        created?.id ??
        (
          await tx
            .select({ id: globalJobSnapshots.id })
            .from(globalJobSnapshots)
            .where(
              and(eq(globalJobSnapshots.jobId, job.id), eq(globalJobSnapshots.materialHash, hash)),
            )
            .limit(1)
        )[0]?.id ??
        null;
      if (!snapshotId) throw new Error("Global job snapshot could not be persisted");
      await tx
        .update(globalJobs)
        .set({
          currentSnapshotId: snapshotId,
          currentMaterialHash: hash,
          rowVersion: sql`${globalJobs.rowVersion} + 1`,
          updatedAt: context.observedAt,
        })
        .where(eq(globalJobs.id, job.id));
    }

    await tx
      .insert(globalJobSourceLinks)
      .values({
        jobId: job.id,
        careerSourceId: context.sourceId,
        externalJobId: listing.externalId,
        sourceUrl: listing.officialUrl,
        authoritative: true,
        firstSeenAt: job.firstSeenAt,
        lastSeenAt: context.observedAt,
      })
      .onConflictDoUpdate({
        target: [globalJobSourceLinks.jobId, globalJobSourceLinks.careerSourceId],
        set: {
          externalJobId: listing.externalId,
          sourceUrl: listing.officialUrl,
          authoritative: true,
          lastSeenAt: context.observedAt,
          updatedAt: context.observedAt,
        },
      });

    for (const fingerprint of fingerprints)
      await tx
        .insert(globalJobFingerprints)
        .values({
          jobId: job.id,
          kind: fingerprint.kind,
          fingerprint: fingerprint.fingerprint,
          confidence: fingerprint.confidence,
        })
        .onConflictDoUpdate({
          target: [globalJobFingerprints.kind, globalJobFingerprints.fingerprint],
          set: {
            active: true,
            confidence: fingerprint.confidence,
            updatedAt: context.observedAt,
          },
        });

    const lifecycleReason = !existing
      ? "Official listing first verified"
      : reopened
        ? "Official listing reopened"
        : changed
          ? "Official listing materially changed"
          : null;
    if (lifecycleReason)
      await tx.insert(globalJobLifecycleEvents).values({
        jobId: job.id,
        fromStatus: previousStatus,
        toStatus: nextStatus,
        reason: lifecycleReason,
        evidence: { sourceId: context.sourceId, materialHash: hash },
        occurredAt: context.observedAt,
      });

    await tx
      .update(coverageBenchmarks)
      .set({
        matched: true,
        firstseenDetectedAt: context.observedAt,
        detectionLatencyMinutes: sql`greatest(0, extract(epoch from (${context.observedAt.toISOString()}::timestamptz - ${coverageBenchmarks.independentObservedAt})) / 60)`,
        updatedAt: context.observedAt,
      })
      .where(
        and(
          eq(coverageBenchmarks.expectedOfficialUrlHash, coverageUrlHash(normalizedUrl)),
          eq(coverageBenchmarks.matched, false),
        ),
      );

    return {
      jobId: job.id,
      snapshotId,
      changed,
      reopened,
      firstSeenAt: job.firstSeenAt,
      postedAt: job.postedAt ?? postedAt,
      postedAtConfidence: job.postedAt ? job.postedAtConfidence : normalizedPosted.confidence,
      reopenedAt: reopened ? context.observedAt : job.reopenedAt,
    };
  });
}
