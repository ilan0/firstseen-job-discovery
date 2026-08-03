import type { SourceConfidence } from "@/connectors/types";

export type FreshnessBand = "hot" | "very_fresh" | "current" | "aging" | "stale";

export function freshness(
  now: Date,
  postedAt: Date | null,
  postedAtConfidence: SourceConfidence,
  firstSeenAt: Date,
): {
  band: FreshnessBand;
  value: number;
  ageHours: number;
  basis: "posted_at" | "first_seen";
} {
  const reliablePostedAt = postedAt && postedAtConfidence !== "low" ? postedAt : null;
  const basis = reliablePostedAt ? "posted_at" : "first_seen";
  const timestamp = reliablePostedAt ?? firstSeenAt;
  const ageHours = Math.max(0, (now.getTime() - timestamp.getTime()) / 3_600_000);
  const band =
    ageHours <= 24
      ? "hot"
      : ageHours <= 72
        ? "very_fresh"
        : ageHours <= 24 * 7
          ? "current"
          : ageHours <= 24 * 30
            ? "aging"
            : "stale";
  const value =
    ageHours <= 6 ? 100 : ageHours <= 24 ? 92 : ageHours <= 72 ? 78 : ageHours <= 168 ? 55 : 25;
  return { band, value, ageHours, basis };
}
