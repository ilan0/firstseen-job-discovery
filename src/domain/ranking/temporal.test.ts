import { describe, expect, it } from "vitest";
import { freshness } from "@/domain/jobs";
import { projectTemporalRecommendation } from "./temporal";

const dimensions = [
  {
    dimension: "required_experience_alignment",
    value: 70,
    confidence: 95,
    explanation: "Stored experience.",
  },
  {
    dimension: "source_confidence",
    value: 95,
    confidence: 100,
    explanation: "Stored source confidence.",
  },
  {
    dimension: "referral_advantage",
    value: 100,
    confidence: 100,
    explanation: "Stored referral.",
  },
  { dimension: "freshness", value: 100, confidence: 95, explanation: "Stored at analysis." },
  { dimension: "competition_proxy", value: 90, confidence: 35, explanation: "Limited proxy." },
  { dimension: "urgency", value: 94, confidence: 95, explanation: "Apply now." },
];

describe("dynamic temporal ranking projection", () => {
  it("keeps a genuinely fresh Hot recommendation current at read time", () => {
    const current = freshness(
      new Date("2026-08-04T18:00:00Z"),
      new Date("2026-08-04T16:00:00Z"),
      "high",
      new Date("2026-08-04T16:00:00Z"),
    );
    const projected = projectTemporalRecommendation({
      band: "hot",
      urgency: 94,
      headline: "Fresh early-career match—apply now",
      routingReasons: ["Freshness 100"],
      dimensions,
      freshness: current,
    });

    expect(projected).toMatchObject({ band: "hot", urgency: 94 });
    expect(projected.dimensions.find((item) => item.dimension === "freshness")).toMatchObject({
      value: 100,
      explanation: "Official posting time is 2 hours old.",
    });
  });

  it("demotes an aged Hot label and recomputes every time-sensitive explanation", () => {
    const current = freshness(
      new Date("2026-08-08T18:00:00Z"),
      new Date("2026-08-04T16:00:00Z"),
      "high",
      new Date("2026-08-04T16:00:00Z"),
    );
    const projected = projectTemporalRecommendation({
      band: "hot",
      urgency: 94,
      headline: "Fresh early-career match—apply now",
      routingReasons: ["Experience 70", "Freshness 100"],
      dimensions,
      freshness: current,
    });

    expect(projected).toMatchObject({
      band: "strong",
      urgency: 69,
      headline: "Strong fit across the most important dimensions",
      routingReasons: ["Experience 70", "Freshness 55"],
    });
    expect(projected.dimensions.find((item) => item.dimension === "freshness")).toMatchObject({
      value: 55,
      explanation: "Official posting time is 98 hours old.",
    });
    expect(projected.dimensions.find((item) => item.dimension === "competition_proxy")?.value).toBe(
      45,
    );
    expect(projected.dimensions.find((item) => item.dimension === "urgency")?.value).toBe(69);
  });
});
