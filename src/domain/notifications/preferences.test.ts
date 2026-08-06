import { describe, expect, it } from "vitest";
import {
  balancedPreferenceInput,
  materializePreset,
  notificationPreferenceInputSchema,
  persistedPreferenceValues,
} from "./preferences";

describe("notification preference validation", () => {
  it("materializes every preset into explicit effective values", () => {
    const base = balancedPreferenceInput();
    expect(materializePreset({ ...base, alertPreset: "selective" })).toMatchObject({
      immediatePossible: false,
      hotStrongMaxAgeHours: 24,
    });
    expect(materializePreset({ ...base, alertPreset: "all_viable" })).toMatchObject({
      immediatePossible: true,
      possibleMaxAgeHours: 24,
    });
    expect(materializePreset({ ...base, alertPreset: "off" })).toMatchObject({ enabled: false });
  });

  it("preserves custom values and disables the legacy digest", () => {
    const custom = {
      ...balancedPreferenceInput(),
      alertPreset: "custom" as const,
      possibleMaxAgeHours: 3,
    };
    expect(materializePreset(custom)).toEqual(custom);
    expect(persistedPreferenceValues(custom)).toMatchObject({
      alertPreset: "custom",
      possibleMaxAgeHours: 3,
      digest: false,
    });
  });

  it("rejects invalid freshness, quiet hours, role lists, and time zones", () => {
    const base = balancedPreferenceInput();
    expect(
      notificationPreferenceInputSchema.safeParse({ ...base, possibleMaxAgeHours: 25 }).success,
    ).toBe(false);
    expect(
      notificationPreferenceInputSchema.safeParse({ ...base, quietHoursStart: -1 }).success,
    ).toBe(false);
    expect(notificationPreferenceInputSchema.safeParse({ ...base, roleFamilies: [] }).success).toBe(
      false,
    );
    expect(
      notificationPreferenceInputSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success,
    ).toBe(false);
  });
});
