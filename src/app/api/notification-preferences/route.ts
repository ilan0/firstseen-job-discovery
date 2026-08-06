import { NextResponse } from "next/server";
import { rolloutFlags } from "@/config/rollout";
import { notificationPreferenceInputSchema } from "@/domain/notifications/preferences";
import { currentOwner } from "@/lib/auth/owner";
import { serverEnv } from "@/lib/env/server";
import {
  listCompanyNotificationOverrides,
  listPushDevices,
  loadGlobalPushPreference,
  preferenceRecordToInput,
  saveGlobalPushPreference,
} from "@/lib/notifications/preferences";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { hasTrustedMutationOrigin } from "@/lib/security/request-origin";

function unavailable() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET() {
  if (!rolloutFlags().webPush) return unavailable();
  const owner = await currentOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { channel, preference } = await loadGlobalPushPreference(owner.id);
  const [devices, companies] = await Promise.all([
    listPushDevices(owner.id),
    listCompanyNotificationOverrides(owner.id, channel.id),
  ]);
  return NextResponse.json({
    preference: preferenceRecordToInput(preference),
    channel: {
      enabled: channel.enabled,
      lastSuccessAt: null,
    },
    devices: devices.map((device) => ({
      ...device,
      lastUsedAt: device.lastUsedAt?.toISOString() ?? null,
      createdAt: device.createdAt.toISOString(),
    })),
    companies,
  });
}

export async function PATCH(request: Request) {
  if (!rolloutFlags().webPush) return unavailable();
  const owner = await currentOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const env = serverEnv();
  if (!hasTrustedMutationOrigin(request, env.NEXT_PUBLIC_APP_URL))
    return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
  const limit = await consumeRateLimit({
    namespace: "notification_preference_mutation",
    identifier: owner.id,
    maximum: 30,
    windowMinutes: 10,
    blockMinutes: 10,
  });
  if (!limit.allowed)
    return NextResponse.json(
      { error: "Too many notification-setting changes" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  const parsed = notificationPreferenceInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid notification settings", issues: parsed.error.issues },
      { status: 400 },
    );
  const saved = await saveGlobalPushPreference(owner.id, parsed.data);
  return NextResponse.json({ preference: preferenceRecordToInput(saved) });
}
