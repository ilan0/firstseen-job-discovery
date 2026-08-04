import type { SourceConfidence } from "@/connectors/types";

export type PostedWindow = "6h" | "24h" | "3d" | "7d" | "30d" | "all";
export type FeedSort = "posted_newest" | "detected_newest" | "urgency";
export type FreshnessBand = "hot" | "very_fresh" | "current" | "aging" | "stale";
export type FreshnessSection = "just_posted" | "new" | "recent" | "older" | "stale";

export const postedWindowHours: Record<Exclude<PostedWindow, "all">, number> = {
  "6h": 6,
  "24h": 24,
  "3d": 72,
  "7d": 168,
  "30d": 720,
};

export function parsePostedWindow(value: unknown, fallback: PostedWindow = "7d"): PostedWindow {
  return value === "6h" ||
    value === "24h" ||
    value === "3d" ||
    value === "7d" ||
    value === "30d" ||
    value === "all"
    ? value
    : fallback;
}

export function parseFeedSort(value: unknown, fallback: FeedSort = "posted_newest"): FeedSort {
  return value === "posted_newest" || value === "detected_newest" || value === "urgency"
    ? value
    : fallback;
}

export function normalizePostedTimestamp(
  value: string | null,
  confidence: SourceConfidence,
  observedAt: Date,
): { postedAt: string | null; confidence: SourceConfidence; anomalous: boolean } {
  if (!value) return { postedAt: null, confidence: "low", anomalous: false };
  const parsed = new Date(value);
  const anomalous =
    Number.isNaN(parsed.getTime()) || parsed.getTime() > observedAt.getTime() + 5 * 60_000;
  return anomalous
    ? { postedAt: null, confidence: "low", anomalous: true }
    : { postedAt: parsed.toISOString(), confidence, anomalous: false };
}

export function freshness(
  now: Date,
  postedAt: Date | null,
  postedAtConfidence: SourceConfidence,
  firstSeenAt: Date,
  reopenedAt: Date | null = null,
): {
  band: FreshnessBand;
  section: FreshnessSection;
  value: number;
  ageHours: number;
  effectiveAt: Date;
  basis: "posted_at" | "first_seen" | "reopened_at";
} {
  const validReopenedAt =
    reopenedAt && reopenedAt.getTime() <= now.getTime() + 5 * 60_000 ? reopenedAt : null;
  const reliablePostedAt =
    postedAt && postedAtConfidence !== "low" && postedAt.getTime() <= now.getTime() + 5 * 60_000
      ? postedAt
      : null;
  const basis = validReopenedAt ? "reopened_at" : reliablePostedAt ? "posted_at" : "first_seen";
  const effectiveAt = validReopenedAt ?? reliablePostedAt ?? firstSeenAt;
  const ageHours = Math.max(0, (now.getTime() - effectiveAt.getTime()) / 3_600_000);
  const band =
    ageHours <= 6
      ? "hot"
      : ageHours <= 24
        ? "very_fresh"
        : ageHours <= 168
          ? "current"
          : ageHours <= 720
            ? "aging"
            : "stale";
  const section =
    ageHours <= 24
      ? "just_posted"
      : ageHours <= 72
        ? "new"
        : ageHours <= 168
          ? "recent"
          : ageHours <= 720
            ? "older"
            : "stale";
  const value =
    ageHours <= 6 ? 100 : ageHours <= 24 ? 92 : ageHours <= 72 ? 78 : ageHours <= 168 ? 55 : 25;
  return { band, section, value, ageHours, effectiveAt, basis };
}

export function withinPostedWindow(ageHours: number, window: PostedWindow): boolean {
  return window === "all" || ageHours <= postedWindowHours[window];
}
