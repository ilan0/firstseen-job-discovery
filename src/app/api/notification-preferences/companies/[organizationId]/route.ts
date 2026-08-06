import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { notificationPreferences, userCompanyFollows } from "@/db/schema";
import { rolloutFlags } from "@/config/rollout";
import { companyOverrideInputSchema } from "@/domain/notifications/preferences";
import { currentOwner } from "@/lib/auth/owner";
import { serverEnv } from "@/lib/env/server";
import { loadGlobalPushPreference } from "@/lib/notifications/preferences";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { hasTrustedMutationOrigin } from "@/lib/security/request-origin";

async function context(request: Request, organizationId: string) {
  if (!rolloutFlags().webPush)
    return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const owner = await currentOwner();
  if (!owner) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!hasTrustedMutationOrigin(request, serverEnv().NEXT_PUBLIC_APP_URL))
    return { response: NextResponse.json({ error: "Untrusted request origin" }, { status: 403 }) };
  const [company] = await db
    .select({ id: userCompanyFollows.id })
    .from(userCompanyFollows)
    .where(
      and(
        eq(userCompanyFollows.userId, owner.id),
        eq(userCompanyFollows.organizationId, organizationId),
        eq(userCompanyFollows.active, true),
      ),
    )
    .limit(1);
  if (!company)
    return { response: NextResponse.json({ error: "Company not found" }, { status: 404 }) };
  const limit = await consumeRateLimit({
    namespace: "company_notification_override",
    identifier: owner.id,
    maximum: 60,
    windowMinutes: 10,
    blockMinutes: 10,
  });
  if (!limit.allowed)
    return {
      response: NextResponse.json(
        { error: "Too many company-setting changes" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      ),
    };
  return { owner, channel: (await loadGlobalPushPreference(owner.id)).channel };
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;
  const state = await context(request, organizationId);
  if ("response" in state) return state.response;
  const parsed = companyOverrideInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.mode === "global")
    return NextResponse.json({ error: "Invalid company override" }, { status: 400 });
  await db
    .insert(notificationPreferences)
    .values({
      userId: state.owner.id,
      channelId: state.channel.id,
      organizationId,
      companyOverrideMode: parsed.data.mode,
      enabled: true,
      digest: false,
    })
    .onConflictDoUpdate({
      target: [notificationPreferences.channelId, notificationPreferences.organizationId],
      targetWhere: eq(notificationPreferences.organizationId, organizationId),
      set: { companyOverrideMode: parsed.data.mode, updatedAt: new Date() },
    });
  return NextResponse.json({ mode: parsed.data.mode });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;
  const state = await context(request, organizationId);
  if ("response" in state) return state.response;
  await db
    .delete(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, state.owner.id),
        eq(notificationPreferences.channelId, state.channel.id),
        eq(notificationPreferences.organizationId, organizationId),
      ),
    );
  return NextResponse.json({ mode: "global" });
}
