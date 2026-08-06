import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  notificationChannels,
  notificationPreferences,
  organizations,
  pushSubscriptions,
  referralRequests,
  userCompanyFollows,
} from "@/db/schema";
import {
  alertRoleFamilies,
  balancedPreferenceInput,
  notificationPreferenceInputSchema,
  persistedPreferenceValues,
  toPolicy,
  type NotificationPreferenceInput,
} from "@/domain/notifications/preferences";
import type { CompanyAlertMode } from "@/domain/notifications/policy";

export async function ensureWebPushChannel(userId: string) {
  const [channel] = await db
    .insert(notificationChannels)
    .values({ userId, kind: "web_push", label: "Browser push", enabled: true })
    .onConflictDoUpdate({
      target: [notificationChannels.userId, notificationChannels.kind, notificationChannels.label],
      set: { updatedAt: new Date() },
    })
    .returning({ id: notificationChannels.id, enabled: notificationChannels.enabled });
  if (!channel) throw new Error("Push channel could not be configured.");
  const [existing] = await db
    .select({ id: notificationPreferences.id })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.channelId, channel.id),
        isNull(notificationPreferences.organizationId),
      ),
    )
    .limit(1);
  if (!existing)
    await db
      .insert(notificationPreferences)
      .values({
        userId,
        channelId: channel.id,
        ...persistedPreferenceValues(balancedPreferenceInput()),
      })
      .onConflictDoNothing();
  return channel;
}

export async function loadGlobalPushPreference(userId: string) {
  const channel = await ensureWebPushChannel(userId);
  const [preference] = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.channelId, channel.id),
        isNull(notificationPreferences.organizationId),
      ),
    )
    .limit(1);
  if (!preference) throw new Error("Push preference could not be configured.");
  return { channel, preference };
}

export async function saveGlobalPushPreference(userId: string, input: NotificationPreferenceInput) {
  const { channel } = await loadGlobalPushPreference(userId);
  const [saved] = await db
    .update(notificationPreferences)
    .set(persistedPreferenceValues(input))
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.channelId, channel.id),
        isNull(notificationPreferences.organizationId),
      ),
    )
    .returning();
  if (!saved) throw new Error("Push preference could not be saved.");
  return saved;
}

export async function listPushDevices(userId: string) {
  return db
    .select({
      id: pushSubscriptions.id,
      deviceLabel: pushSubscriptions.deviceLabel,
      userAgentSafe: pushSubscriptions.userAgentSafe,
      detailedLockScreen: pushSubscriptions.detailedLockScreen,
      lastUsedAt: pushSubscriptions.lastUsedAt,
      failureCount: pushSubscriptions.failureCount,
      revokedAt: pushSubscriptions.revokedAt,
      createdAt: pushSubscriptions.createdAt,
    })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.revokedAt)));
}

export async function listCompanyNotificationOverrides(userId: string, channelId: string) {
  const [rows, referralRows] = await Promise.all([
    db
      .select({
        organizationId: organizations.id,
        name: organizations.name,
        interested: userCompanyFollows.interested,
        scope: userCompanyFollows.scope,
        overrideMode: notificationPreferences.companyOverrideMode,
      })
      .from(userCompanyFollows)
      .innerJoin(organizations, eq(userCompanyFollows.organizationId, organizations.id))
      .leftJoin(
        notificationPreferences,
        and(
          eq(notificationPreferences.channelId, channelId),
          eq(notificationPreferences.organizationId, organizations.id),
        ),
      )
      .where(
        and(
          eq(userCompanyFollows.userId, userId),
          eq(userCompanyFollows.active, true),
          eq(userCompanyFollows.stickyDismissed, false),
          eq(userCompanyFollows.scope, "personal"),
        ),
      ),
    db
      .select({ organizationId: referralRequests.organizationId })
      .from(referralRequests)
      .where(
        and(
          eq(referralRequests.userId, userId),
          inArray(referralRequests.status, ["available", "requested", "agreed", "submitted"]),
        ),
      ),
  ]);
  const referrals = new Set(referralRows.map((row) => row.organizationId));
  return rows.map((row) => ({ ...row, hasActiveReferral: referrals.has(row.organizationId) }));
}

export function preferenceRecordToInput(record: typeof notificationPreferences.$inferSelect) {
  const roles = record.roleFamilies.filter((role) =>
    alertRoleFamilies.includes(role as (typeof alertRoleFamilies)[number]),
  );
  return notificationPreferenceInputSchema.parse({
    enabled: record.enabled,
    alertPreset: record.alertPreset,
    immediateHot: record.immediateHot,
    immediateStrong: record.immediateStrong,
    immediatePossible: record.immediatePossible,
    referralCompany: record.referralCompany,
    interestedCompany: record.interestedCompany,
    hotStrongMaxAgeHours: record.hotStrongMaxAgeHours,
    possibleMaxAgeHours: record.possibleMaxAgeHours,
    roleFamilies: roles.length ? roles : balancedPreferenceInput().roleFamilies,
    quietHoursEnabled: record.quietHoursEnabled,
    quietHoursStart: record.quietHoursStart,
    quietHoursEnd: record.quietHoursEnd,
    timezone: record.timezone,
  });
}

export async function loadEffectivePushPolicy(userId: string, organizationId: string) {
  const { channel, preference } = await loadGlobalPushPreference(userId);
  const [override] = await db
    .select({ mode: notificationPreferences.companyOverrideMode })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.channelId, channel.id),
        eq(notificationPreferences.organizationId, organizationId),
      ),
    )
    .limit(1);
  return {
    channel,
    input: preferenceRecordToInput(preference),
    policy: toPolicy(preferenceRecordToInput(preference)),
    companyOverrideMode: (override?.mode ?? null) as CompanyAlertMode,
  };
}
