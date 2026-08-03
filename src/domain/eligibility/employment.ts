import { metadataEvidence } from "./evidence";
import type { Employment, Fact } from "./types";

const patterns: Array<[Employment, RegExp]> = [
  ["part_time", /\bpart[- ]time\b/i],
  ["internship", /\b(?:internship|intern)\b/i],
  ["contract", /\b(?:contract(?:or)?|contract-to-hire|c2c|w2 contract)\b/i],
  ["temporary", /\btemporary\b/i],
  ["full_time", /\bfull[- ]time\b/i],
];

export function extractEmployment(
  metadata: string | null | undefined,
  description: string,
): Fact<Employment> {
  if (metadata) {
    for (const [value, pattern] of patterns) {
      const match = metadata.match(pattern);
      if (match) {
        return {
          value,
          confidence: "high",
          evidence: [metadataEvidence("employment_type", match[0])],
        };
      }
    }
  }
  for (const [value, pattern] of patterns) {
    const match = description.match(pattern);
    if (match) {
      return {
        value,
        confidence: "medium",
        evidence: [metadataEvidence("employment_type", match[0])],
      };
    }
  }
  return { value: "unknown", confidence: "low", evidence: [] };
}
