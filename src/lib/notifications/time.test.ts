import { describe, expect, it } from "vitest";
import { hoursUntilQuietEnd, inQuietHours, zonedParts } from "./time";
describe("notification time zones", () => {
  it("uses Eastern local dates across UTC day boundaries", () => {
    expect(zonedParts(new Date("2026-08-04T02:00:00Z"), "America/New_York")).toEqual({
      localDate: "2026-08-03",
      hour: 22,
    });
  });
  it("handles daylight saving time", () => {
    expect(zonedParts(new Date("2026-07-01T12:00:00Z"), "America/New_York").hour).toBe(8);
    expect(zonedParts(new Date("2026-01-01T13:00:00Z"), "America/New_York").hour).toBe(8);
  });
  it("supports quiet hours that cross midnight", () => {
    expect(inQuietHours(23, 22, 7)).toBe(true);
    expect(inQuietHours(6, 22, 7)).toBe(true);
    expect(inQuietHours(12, 22, 7)).toBe(false);
    expect(hoursUntilQuietEnd(23, 22, 7)).toBe(8);
    expect(hoursUntilQuietEnd(6, 22, 7)).toBe(1);
  });
});
