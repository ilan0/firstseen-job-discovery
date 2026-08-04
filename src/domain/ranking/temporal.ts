import type { freshness } from "@/domain/jobs";
import type { Recommendation } from "./types";

type FreshnessResult = ReturnType<typeof freshness>;
type TemporalDimension = {
  dimension: string;
  value: number;
  confidence: number;
  explanation: string;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function freshnessExplanation(current: FreshnessResult) {
  const subject =
    current.basis === "posted_at"
      ? "Official posting time"
      : current.basis === "reopened_at"
        ? "Official reopening"
        : "First verified sighting";
  return `${subject} is ${Math.round(current.ageHours)} hours old.`;
}

function freshnessConfidence(current: FreshnessResult) {
  return current.basis === "posted_at" ? 95 : current.basis === "reopened_at" ? 100 : 70;
}

export function projectTemporalRecommendation<T extends TemporalDimension>(input: {
  band: Recommendation["band"] | null;
  urgency: number | null;
  headline: string | null;
  routingReasons: string[];
  dimensions: T[];
  freshness: FreshnessResult;
}) {
  const dimensionValues = new Map(input.dimensions.map((item) => [item.dimension, item.value]));
  const experience = dimensionValues.get("required_experience_alignment");
  const source = dimensionValues.get("source_confidence");
  const referral = dimensionValues.get("referral_advantage");
  const urgency =
    experience === undefined || source === undefined
      ? input.urgency === null
        ? null
        : Math.min(input.urgency, input.freshness.value)
      : clamp(
          input.freshness.value * 0.55 +
            experience * 0.2 +
            (referral && referral > 0 ? 15 : 0) +
            source * 0.1,
        );
  const band =
    input.band === "hot" && input.freshness.value < 92 ? ("strong" as const) : input.band;
  const headline =
    input.band === "hot" && band === "strong"
      ? "Strong fit across the most important dimensions"
      : input.headline;
  const dimensions = input.dimensions.map((item) => {
    if (item.dimension === "freshness")
      return {
        ...item,
        value: input.freshness.value,
        confidence: freshnessConfidence(input.freshness),
        explanation: freshnessExplanation(input.freshness),
      };
    if (item.dimension === "competition_proxy")
      return {
        ...item,
        value: input.freshness.value >= 92 ? 90 : input.freshness.value >= 78 ? 70 : 45,
      };
    if (item.dimension === "urgency" && urgency !== null)
      return {
        ...item,
        value: urgency,
        confidence: Math.min(freshnessConfidence(input.freshness), source ?? item.confidence),
        explanation:
          urgency >= 85
            ? "Apply as soon as practical while the listing is fresh."
            : "Apply after higher-urgency matches.",
      };
    return item;
  });
  const routingReasons = input.routingReasons.map((reason) =>
    reason.startsWith("Freshness ") ? `Freshness ${input.freshness.value}` : reason,
  );
  return { band, urgency, headline, dimensions, routingReasons };
}
