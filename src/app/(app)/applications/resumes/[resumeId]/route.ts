import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { resumeVersions } from "@/db/schema";
import { requireOwner } from "@/lib/auth/owner";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ resumeId: string }> },
) {
  const owner = await requireOwner();
  const { resumeId } = await params;
  const [resume] = await db
    .select({ storagePath: resumeVersions.storagePath })
    .from(resumeVersions)
    .where(and(eq(resumeVersions.userId, owner.id), eq(resumeVersions.id, resumeId)))
    .limit(1);
  if (!resume) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const signed = await createSupabaseAdminClient()
    .storage.from("resumes")
    .createSignedUrl(resume.storagePath, 60, { download: true });
  if (signed.error) return NextResponse.json({ error: "Download unavailable" }, { status: 503 });
  return NextResponse.redirect(signed.data.signedUrl, 303);
}
