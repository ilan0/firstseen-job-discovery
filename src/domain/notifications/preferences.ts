import { z } from "zod";
import type { RoleFamily } from "@/domain/eligibility/types";
import {
  presetPolicy,
  priorityAlertRoleFamilies,
  PUSH_POLICY_VERSION,
  type AlertPreset,
  type NotificationPolicy,
} from "./policy";

export const alertRoleFamilies = [
  "general_swe",
  "full_stack",
  "backend",
  "frontend",
  "ai_engineering",
  "embedded",
  "internal_automation",
  "customer_facing",
  "other",
] as const satisfies readonly RoleFamily[];

export const notificationPreferenceInputSchema = z
  .object({
    enabled: z.boolean(),
    alertPreset: z.enum(["off", "selective", "balanced", "all_viable", "custom"]),
    immediateHot: z.boolean(),
    immediateStrong: z.boolean(),
    immediatePossible: z.boolean(),
    referralCompany: z.boolean(),
    interestedCompany: z.boolean(),
    hotStrongMaxAgeHours: z.number().int().min(1).max(24),
    possibleMaxAgeHours: z.number().int().min(1).max(24),
    roleFamilies: z.array(z.enum(alertRoleFamilies)).min(1).max(alertRoleFamilies.length),
    quietHoursEnabled: z.boolean(),
    quietHoursStart: z.number().int().min(0).max(23),
    quietHoursEnd: z.number().int().min(0).max(23),
    timezone: z.string().min(1).max(80),
  })
  .superRefine((value, context) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value.timezone }).format(new Date());
    } catch {
      context.addIssue({ code: "custom", path: ["timezone"], message: "Unknown time zone" });
    }
  });

export type NotificationPreferenceInput = z.infer<typeof notificationPreferenceInputSchema>;

export function balancedPreferenceInput(): NotificationPreferenceInput {
  return {
    enabled: true,
    alertPreset: "balanced",
    immediateHot: true,
    immediateStrong: true,
    immediatePossible: true,
    referralCompany: true,
    interestedCompany: true,
    hotStrongMaxAgeHours: 24,
    possibleMaxAgeHours: 6,
    roleFamilies: [...priorityAlertRoleFamilies],
    quietHoursEnabled: true,
    quietHoursStart: 23,
    quietHoursEnd: 7,
    timezone: "America/New_York",
  };
}

export function materializePreset(input: NotificationPreferenceInput): NotificationPreferenceInput {
  if (input.alertPreset === "custom") return input;
  const values = presetPolicy(input.alertPreset);
  return notificationPreferenceInputSchema.parse({ ...input, ...values });
}

export function toPolicy(input: NotificationPreferenceInput): NotificationPolicy {
  const effective = materializePreset(input);
  return {
    enabled: effective.enabled,
    preset: effective.alertPreset,
    immediateHot: effective.immediateHot,
    immediateStrong: effective.immediateStrong,
    immediatePossible: effective.immediatePossible,
    referralCompany: effective.referralCompany,
    interestedCompany: effective.interestedCompany,
    hotStrongMaxAgeHours: effective.hotStrongMaxAgeHours,
    possibleMaxAgeHours: effective.possibleMaxAgeHours,
    roleFamilies: effective.roleFamilies,
    quietHoursEnabled: effective.quietHoursEnabled,
    quietHoursStart: effective.quietHoursStart,
    quietHoursEnd: effective.quietHoursEnd,
    timezone: effective.timezone,
  };
}

export function persistedPreferenceValues(input: NotificationPreferenceInput) {
  const effective = materializePreset(input);
  return {
    enabled: effective.enabled,
    alertPreset: effective.alertPreset as AlertPreset,
    immediateHot: effective.immediateHot,
    immediateStrong: effective.immediateStrong,
    immediatePossible: effective.immediatePossible,
    referralCompany: effective.referralCompany,
    interestedCompany: effective.interestedCompany,
    hotStrongMaxAgeHours: effective.hotStrongMaxAgeHours,
    possibleMaxAgeHours: effective.possibleMaxAgeHours,
    roleFamilies: effective.roleFamilies,
    quietHoursEnabled: effective.quietHoursEnabled,
    quietHoursStart: effective.quietHoursStart,
    quietHoursEnd: effective.quietHoursEnd,
    timezone: effective.timezone,
    digest: false,
    policyVersion: PUSH_POLICY_VERSION,
    updatedAt: new Date(),
  };
}

export const companyOverrideInputSchema = z.object({
  mode: z.enum(["always", "mute", "global"]),
});
