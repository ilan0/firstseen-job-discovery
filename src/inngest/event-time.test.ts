import { describe, expect, it } from "vitest";
import { eventDateTime } from "./event-time";

describe("worker event timestamps", () => {
  it.each([
    "2026-08-04T20:18:31.501Z",
    "2026-08-04T20:18:31.501+00:00",
    "2026-08-04T16:18:31.501-04:00",
  ])("accepts standards-compliant instant %s", (value) => {
    expect(eventDateTime.safeParse(value).success).toBe(true);
  });

  it.each(["2026-08-04", "not-a-date", "2026-08-04T25:00:00Z"])(
    "rejects invalid instant %s",
    (value) => {
      expect(eventDateTime.safeParse(value).success).toBe(false);
    },
  );
});
