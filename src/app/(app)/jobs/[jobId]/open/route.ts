import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { canonicalJobs, userActions } from "@/db/schema";
import { requireOwner } from "@/lib/auth/owner";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const owner = await requireOwner();
  const { jobId } = await params;
  const [job] = await db
    .select({
      officialUrl: canonicalJobs.officialUrl,
      lifecycleStatus: canonicalJobs.lifecycleStatus,
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
  const id = randomUUID();
  await db.insert(userActions).values({
    userId: owner.id,
    jobId,
    kind: "opened_official_application",
    idempotencyKey: `${id}:opened`,
    metadata: { hostname: target.hostname },
  });
  return NextResponse.redirect(target, 303);
}
