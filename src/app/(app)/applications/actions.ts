"use server";

import { createHash, randomUUID } from "node:crypto";
import { TZDate } from "@date-fns/tz";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import {
  applicationFollowups,
  applicationPacketEntries,
  applications,
  applicationSessions,
  applicationStageHistory,
  auditEvents,
  queueStateHistory,
  queueStates,
  referralRequests,
  resumeVersions,
  searchPreferences,
  userActions,
} from "@/db/schema";
import {
  applicationStages,
  assertApplicationTransition,
  type ApplicationStage,
} from "@/domain/applications/stages";
import {
  detectResumeMime,
  MAX_RESUME_BYTES,
  safeResumeFilename,
} from "@/domain/applications/resume";
import { requireOwner } from "@/lib/auth/owner";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rolloutFlags } from "@/config/rollout";

function requireApplicationWorkflow() {
  if (!rolloutFlags().applicationWorkflow) throw new Error("Application workflow is not enabled.");
}

const sessionDispositionSchema = z.object({
  sessionId: z.string().uuid(),
  disposition: z.enum(["submitted", "continue_later", "dismissed"]),
});

export async function resolveApplicationSession(formData: FormData) {
  requireApplicationWorkflow();
  const owner = await requireOwner();
  const input = sessionDispositionSchema.parse(Object.fromEntries(formData));
  const now = new Date();
  await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(applicationSessions)
      .where(
        and(eq(applicationSessions.userId, owner.id), eq(applicationSessions.id, input.sessionId)),
      )
      .limit(1);
    if (!session) throw new Error("Application session not found.");
    if (session.disposition === "submitted" && input.disposition === "submitted") return;
    await tx
      .update(applicationSessions)
      .set({ disposition: input.disposition, returnedAt: now, updatedAt: now })
      .where(and(eq(applicationSessions.userId, owner.id), eq(applicationSessions.id, session.id)));
    if (input.disposition !== "submitted") return;

    const existingApplication = session.legacyJobId
      ? (
          await tx
            .select({ id: applications.id })
            .from(applications)
            .where(
              and(
                eq(applications.userId, owner.id),
                eq(applications.legacyJobId, session.legacyJobId),
              ),
            )
            .limit(1)
        )[0]
      : session.globalJobId
        ? (
            await tx
              .select({ id: applications.id })
              .from(applications)
              .where(
                and(
                  eq(applications.userId, owner.id),
                  eq(applications.globalJobId, session.globalJobId),
                ),
              )
              .limit(1)
          )[0]
        : null;
    const [application] = existingApplication
      ? [existingApplication]
      : await tx
          .insert(applications)
          .values({
            userId: owner.id,
            globalJobId: session.globalJobId,
            legacyJobId: session.legacyJobId,
            applicationSessionId: session.id,
            stage: "applied",
            appliedAt: now,
            source: "official_link_return",
          })
          .returning({ id: applications.id });
    if (application && !existingApplication)
      await tx.insert(applicationStageHistory).values({
        userId: owner.id,
        applicationId: application.id,
        fromStage: null,
        toStage: "applied",
        reason: "Confirmed submitted after opening the official application",
      });

    if (!session.legacyJobId) return;
    const [queue] = await tx
      .select()
      .from(queueStates)
      .where(and(eq(queueStates.userId, owner.id), eq(queueStates.jobId, session.legacyJobId)))
      .limit(1);
    if (!queue || queue.status === "applied") return;
    const actionId = randomUUID();
    await tx
      .update(queueStates)
      .set({
        status: "applied",
        rowVersion: queue.rowVersion + 1,
        statusChangedAt: now,
        updatedAt: now,
      })
      .where(and(eq(queueStates.userId, owner.id), eq(queueStates.id, queue.id)));
    await tx.insert(userActions).values({
      id: actionId,
      userId: owner.id,
      jobId: session.legacyJobId,
      kind: "applied",
      idempotencyKey: `${actionId}:return-confirmation`,
      metadata: { source: "application_return_prompt", sessionId: session.id },
    });
    await tx.insert(queueStateHistory).values({
      userId: owner.id,
      jobId: session.legacyJobId,
      fromStatus: queue.status,
      toStatus: "applied",
      actionId,
      reason: "Application submission confirmed",
    });
    await tx.insert(auditEvents).values({
      userId: owner.id,
      eventType: "application.submitted",
      targetType: "application_session",
      targetId: session.id,
      metadataSafe: { applicationId: application?.id },
    });
  });
  revalidatePath("/");
  revalidatePath("/applied");
}

const stageSchema = z.object({
  applicationId: z.string().uuid(),
  stage: z.enum(applicationStages),
  reason: z.string().trim().max(500).optional(),
});

export async function transitionApplicationStage(formData: FormData) {
  requireApplicationWorkflow();
  const owner = await requireOwner();
  const input = stageSchema.parse(Object.fromEntries(formData));
  const now = new Date();
  await db.transaction(async (tx) => {
    const [application] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.userId, owner.id), eq(applications.id, input.applicationId)))
      .limit(1);
    if (!application) throw new Error("Application not found.");
    assertApplicationTransition(application.stage as ApplicationStage, input.stage);
    await tx
      .update(applications)
      .set({ stage: input.stage, updatedAt: now })
      .where(and(eq(applications.userId, owner.id), eq(applications.id, application.id)));
    await tx.insert(applicationStageHistory).values({
      userId: owner.id,
      applicationId: application.id,
      fromStage: application.stage,
      toStage: input.stage,
      reason: input.reason || "Stage updated manually",
      transitionedAt: now,
    });
  });
  revalidatePath("/applied");
}

const followupSchema = z.object({
  applicationId: z.string().uuid(),
  dueDate: z.iso.date(),
  nextAction: z.string().trim().min(2).max(500),
});

export async function addApplicationFollowup(formData: FormData) {
  requireApplicationWorkflow();
  const owner = await requireOwner();
  const input = followupSchema.parse(Object.fromEntries(formData));
  const [application] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.userId, owner.id), eq(applications.id, input.applicationId)))
    .limit(1);
  if (!application) throw new Error("Application not found.");
  const [preferences] = await db
    .select({ timezone: searchPreferences.timezone })
    .from(searchPreferences)
    .where(eq(searchPreferences.userId, owner.id))
    .limit(1);
  const [year, month, day] = input.dueDate.split("-").map(Number);
  const dueAt = new TZDate(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
    9,
    0,
    preferences?.timezone ?? "America/New_York",
  );
  await db.insert(applicationFollowups).values({
    userId: owner.id,
    applicationId: application.id,
    dueAt,
    nextAction: input.nextAction,
  });
  revalidatePath("/applied");
}

export async function completeApplicationFollowup(formData: FormData) {
  requireApplicationWorkflow();
  const owner = await requireOwner();
  const id = z.string().uuid().parse(formData.get("followupId"));
  await db
    .update(applicationFollowups)
    .set({ completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(applicationFollowups.userId, owner.id), eq(applicationFollowups.id, id)));
  revalidatePath("/applied");
}

const applicationDetailsSchema = z.object({
  applicationId: z.string().uuid(),
  resumeVersionId: z.preprocess(
    (value) => (typeof value === "string" && value ? value : null),
    z.string().uuid().nullable(),
  ),
  referralRequestId: z.preprocess(
    (value) => (typeof value === "string" && value ? value : null),
    z.string().uuid().nullable(),
  ),
  notes: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
    z.string().max(5_000).nullable(),
  ),
});

export async function updateApplicationDetails(formData: FormData) {
  requireApplicationWorkflow();
  const owner = await requireOwner();
  const input = applicationDetailsSchema.parse(Object.fromEntries(formData));
  await db.transaction(async (tx) => {
    const [application] = await tx
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.userId, owner.id), eq(applications.id, input.applicationId)))
      .limit(1);
    if (!application) throw new Error("Application not found.");
    if (input.resumeVersionId) {
      const [resume] = await tx
        .select({ id: resumeVersions.id })
        .from(resumeVersions)
        .where(
          and(eq(resumeVersions.userId, owner.id), eq(resumeVersions.id, input.resumeVersionId)),
        )
        .limit(1);
      if (!resume) throw new Error("Resume version not found.");
    }
    if (input.referralRequestId) {
      const [referral] = await tx
        .select({ id: referralRequests.id })
        .from(referralRequests)
        .where(
          and(
            eq(referralRequests.userId, owner.id),
            eq(referralRequests.id, input.referralRequestId),
          ),
        )
        .limit(1);
      if (!referral) throw new Error("Referral request not found.");
    }
    await tx
      .update(applications)
      .set({
        resumeVersionId: input.resumeVersionId,
        referralRequestId: input.referralRequestId,
        notes: input.notes,
        updatedAt: new Date(),
      })
      .where(and(eq(applications.userId, owner.id), eq(applications.id, application.id)));
  });
  revalidatePath("/applied");
}

const packetSchema = z.object({
  category: z.string().trim().min(2).max(80),
  label: z.string().trim().min(2).max(160),
  value: z.string().trim().min(1).max(5_000),
  sensitive: z.enum(["on"]).optional(),
});

export async function addPacketEntry(formData: FormData) {
  requireApplicationWorkflow();
  const owner = await requireOwner();
  const input = packetSchema.parse(Object.fromEntries(formData));
  await db
    .insert(applicationPacketEntries)
    .values({
      userId: owner.id,
      category: input.category,
      label: input.label,
      value: input.value,
      sensitive: Boolean(input.sensitive),
    })
    .onConflictDoUpdate({
      target: [
        applicationPacketEntries.userId,
        applicationPacketEntries.category,
        applicationPacketEntries.label,
      ],
      set: { value: input.value, sensitive: Boolean(input.sensitive), updatedAt: new Date() },
    });
  revalidatePath("/applications/packet");
}

export async function deletePacketEntry(formData: FormData) {
  requireApplicationWorkflow();
  const owner = await requireOwner();
  const id = z.string().uuid().parse(formData.get("entryId"));
  await db
    .update(applicationPacketEntries)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(applicationPacketEntries.userId, owner.id), eq(applicationPacketEntries.id, id)));
  revalidatePath("/applications/packet");
}

export type ResumeUploadState = { error?: string; success?: string };

export async function uploadResume(
  _state: ResumeUploadState,
  formData: FormData,
): Promise<ResumeUploadState> {
  requireApplicationWorkflow();
  const owner = await requireOwner();
  const file = formData.get("resume");
  const label = z.string().trim().min(2).max(160).safeParse(formData.get("label"));
  if (!(file instanceof File) || !label.success)
    return { error: "Choose a resume and give it a short label." };
  if (file.size < 1 || file.size > MAX_RESUME_BYTES)
    return { error: "Resume files must be between 1 byte and 5 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = detectResumeMime(bytes);
  if (!mimeType) return { error: "Only genuine PDF, DOC, or DOCX files are supported." };
  const hash = createHash("sha256").update(bytes).digest("hex");
  const [existing] = await db
    .select({ id: resumeVersions.id })
    .from(resumeVersions)
    .where(and(eq(resumeVersions.userId, owner.id), eq(resumeVersions.sourceHash, hash)))
    .limit(1);
  if (existing) return { success: "That resume version is already saved." };
  const safeName = safeResumeFilename(file.name);
  const storagePath = `${owner.id}/${randomUUID()}-${safeName}`;
  const supabase = createSupabaseAdminClient();
  const uploaded = await supabase.storage.from("resumes").upload(storagePath, bytes, {
    contentType: mimeType,
    upsert: false,
  });
  if (uploaded.error) return { error: "Resume storage failed. Try again." };
  try {
    await db.insert(resumeVersions).values({
      userId: owner.id,
      label: label.data,
      storagePath,
      sourceHash: hash,
      mimeType,
      originalFilename: safeName,
      sizeBytes: file.size,
    });
  } catch (error) {
    await supabase.storage.from("resumes").remove([storagePath]);
    throw error;
  }
  revalidatePath("/applications/packet");
  return { success: `${label.data} was uploaded privately.` };
}

export async function deactivateResume(formData: FormData) {
  requireApplicationWorkflow();
  const owner = await requireOwner();
  const id = z.string().uuid().parse(formData.get("resumeId"));
  await db
    .update(resumeVersions)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(resumeVersions.userId, owner.id), eq(resumeVersions.id, id)));
  revalidatePath("/applications/packet");
}
