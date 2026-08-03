import { evidenceFromMatch } from "./evidence";
import type { Fact, Sponsorship } from "./types";

const compatiblePattern =
  /\b(?:unable to|will not|do not|does not|cannot|no)\s+(?:provide\s+)?(?:employment\s+)?sponsorship\b|\bmust be (?:a )?u\.?s\.? citizen\b|\bauthorized to work in the (?:u\.?s\.?|united states) without sponsorship\b/gi;

export function extractSponsorship(description: string): Fact<Sponsorship> {
  compatiblePattern.lastIndex = 0;
  const match = compatiblePattern.exec(description);
  if (!match) return { value: "not_mentioned", confidence: "high", evidence: [] };
  return {
    value: "compatible",
    confidence: "high",
    evidence: [evidenceFromMatch("sponsorship", description, match)],
  };
}
