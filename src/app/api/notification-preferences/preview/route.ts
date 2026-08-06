import { NextResponse } from "next/server";
import { rolloutFlags } from "@/config/rollout";
import { notificationPreferenceInputSchema } from "@/domain/notifications/preferences";
import { currentOwner } from "@/lib/auth/owner";
import { serverEnv } from "@/lib/env/server";
import { previewNotificationPolicy } from "@/lib/notifications/preview";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { hasTrustedMutationOrigin } from "@/lib/security/request-origin";

export async function POST(request: Request) {
  if (!rolloutFlags().webPush) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const owner = await currentOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasTrustedMutationOrigin(request, serverEnv().NEXT_PUBLIC_APP_URL))
    return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
  const limit = await consumeRateLimit({
    namespace: "notification_policy_preview",
    identifier: owner.id,
    maximum: 20,
    windowMinutes: 10,
    blockMinutes: 5,
  });
  if (!limit.allowed)
    return NextResponse.json(
      { error: "Too many previews" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  const parsed = notificationPreferenceInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid notification settings" }, { status: 400 });
  return NextResponse.json(await previewNotificationPolicy(owner.id, parsed.data));
}
