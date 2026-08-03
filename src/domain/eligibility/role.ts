import { metadataEvidence } from "./evidence";
import type { Fact, RoleFamily } from "./types";

const classifiers: Array<[RoleFamily, RegExp]> = [
  [
    "customer_facing",
    /\b(?:solutions?|sales|customer|field|implementation)\s+(?:software\s+)?engineer\b/i,
  ],
  [
    "internal_automation",
    /\b(?:internal tools?|developer productivity|automation)\s+(?:software\s+)?engineer\b/i,
  ],
  ["embedded", /\b(?:embedded|firmware|systems? software)\s+(?:software\s+)?engineer\b/i],
  [
    "ai_engineering",
    /\b(?:ai|artificial intelligence|machine learning|ml|llm)\s+(?:software\s+)?engineer\b/i,
  ],
  ["full_stack", /\bfull[- ]stack\b/i],
  ["backend", /\bback[- ]end\b|\bbackend\b/i],
  ["frontend", /\bfront[- ]end\b|\bfrontend\b|\bui engineer\b/i],
  [
    "general_swe",
    /\bsoftware (?:development )?engineer\b|\bsoftware developer\b|\bapplication developer\b|\bmember of technical staff\b|\bmobile (?:software )?(?:engineer|developer)\b|\b(?:product|platform|data|cloud|devops|site reliability|sre) engineer\b/i,
  ],
];

export function classifyRole(title: string): Fact<RoleFamily> {
  for (const [value, pattern] of classifiers) {
    const match = title.match(pattern);
    if (match) {
      return { value, confidence: "high", evidence: [metadataEvidence("role_family", match[0])] };
    }
  }
  return {
    value: "other",
    confidence: "medium",
    evidence: [metadataEvidence("role_family", title)],
  };
}

export function isPotentialSoftwareRole(title: string): boolean {
  return /\b(?:software|developer|programmer|full[- ]stack|back[- ]end|backend|front[- ]end|frontend|mobile|web|ai|artificial intelligence|machine learning|ml|llm|data|cloud|devops|site reliability|sre|technical staff|technology analyst)\b/i.test(
    title,
  );
}
