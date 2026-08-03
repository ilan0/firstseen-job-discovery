import { evidenceFromMatch } from "./evidence";
import type { Fact, Clearance } from "./types";

const noClearancePattern =
  /\b(?:no|without)\s+(?:a\s+)?(?:security\s+)?clearance(?:\s+(?:or|and)\s+public\s+trust)?\s+(?:(?:is|are)\s+)?required\b|\b(?:security\s+)?clearance(?:\s+(?:or|and)\s+public\s+trust)?\s+(?:is|are)\s+not\s+required\b|\bdoes\s+not\s+require\s+(?:a\s+)?(?:security\s+)?clearance\b/gi;
const clearancePattern =
  /\b(?:active\s+|current\s+)?(?:top\s+secret|secret|confidential|ts\/sci|sci|security)\s+clearance\b|\b(?:ability|able|eligible|willingness)\s+to\s+(?:obtain|maintain)\s+(?:a\s+)?(?:security\s+)?clearance\b|\bclearance\s+(?:eligibility|required|is required)\b/gi;
const publicTrustPattern =
  /\bpublic\s+trust\b|\b(?:moderate|high)\s+risk\s+(?:public\s+trust|suitability)\b|\bsuitability\s+(?:determination|clearance|investigation)\b/gi;
const noPublicTrustPattern =
  /\bno\s+(?:(?:security\s+)?clearance\s+(?:or|and)\s+)?public\s+trust\s+(?:(?:is|are)\s+)?required\b|\b(?:(?:security\s+)?clearance\s+(?:or|and)\s+)?public\s+trust\s+(?:is|are)\s+not\s+required\b/gi;

function extractPattern(field: string, description: string, pattern: RegExp): Fact<Clearance> {
  pattern.lastIndex = 0;
  const match = pattern.exec(description);
  if (!match) return { value: "not_mentioned", confidence: "high", evidence: [] };
  return {
    value: "required",
    confidence: "high",
    evidence: [evidenceFromMatch(field, description, match)],
  };
}

export function extractClearance(description: string): Fact<Clearance> {
  noClearancePattern.lastIndex = 0;
  const negation = noClearancePattern.exec(description);
  if (negation) {
    const remainder = `${description.slice(0, negation.index)} ${description.slice(
      negation.index + negation[0].length,
    )}`;
    const other = extractPattern("clearance", remainder, clearancePattern);
    if (other.value === "required") return other;
    return {
      value: "not_required",
      confidence: "high",
      evidence: [evidenceFromMatch("clearance", description, negation)],
    };
  }
  return extractPattern("clearance", description, clearancePattern);
}

export function extractPublicTrust(description: string): Fact<Clearance> {
  noPublicTrustPattern.lastIndex = 0;
  const negation = noPublicTrustPattern.exec(description);
  if (negation) {
    const remainder = `${description.slice(0, negation.index)} ${description.slice(negation.index + negation[0].length)}`;
    const other = extractPattern("public_trust", remainder, publicTrustPattern);
    if (other.value === "required") return other;
    return {
      value: "not_required",
      confidence: "high",
      evidence: [evidenceFromMatch("public_trust", description, negation)],
    };
  }
  return extractPattern("public_trust", description, publicTrustPattern);
}
