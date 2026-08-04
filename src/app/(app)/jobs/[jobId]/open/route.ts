import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { applicationSessions, canonicalJobs, userActions } from "@/db/schema";
import { requireOwner } from "@/lib/auth/owner";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const owner = await requireOwner();
  const { jobId } = await params;
  const [job] = await db
    .select({
      officialUrl: canonicalJobs.officialUrl,
      lifecycleStatus: canonicalJobs.lifecycleStatus,
      globalJobId: canonicalJobs.globalJobId,
    })
    .from(canonicalJobs)
    .where(and(eq(canonicalJobs.userId, owner.id), eq(canonicalJobs.id, jobId)))
    .limit(1);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (job.lifecycleStatus === "closed")
    return NextResponse.json({ error: "Official listing is closed" }, { status: 410 });
  if (job.lifecycleStatus !== "open" && job.lifecycleStatus !== "reopened")
    return NextResponse.json(
      { error: "Official listing is not currently verified as open" },
      { status: 409 },
    );
  const target = new URL(job.officialUrl);
  if (target.protocol !== "https:" || target.username || target.password)
    return NextResponse.json({ error: "Unsafe official URL" }, { status: 400 });
  const actionId = randomUUID();
  await db.transaction(async (tx) => {
    const [session] = await tx
      .insert(applicationSessions)
      .values({
        userId: owner.id,
        globalJobId: job.globalJobId,
        legacyJobId: jobId,
        officialUrl: target.toString(),
        disposition: "opened",
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      })
      .returning({ id: applicationSessions.id });
    await tx.insert(userActions).values({
      userId: owner.id,
      jobId,
      kind: "opened_official_application",
      idempotencyKey: `${actionId}:opened`,
      metadata: { hostname: target.hostname, applicationSessionId: session?.id },
    });
  });
  return NextResponse.redirect(target, 303);
}
