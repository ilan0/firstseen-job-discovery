import type { JobAnalysis } from "./schema";

type EvidenceContainer = { evidence: JobAnalysis["employment"]["evidence"] };

function allEvidence(analysis: JobAnalysis): JobAnalysis["employment"]["evidence"] {
  const facts: EvidenceContainer[] = [
    analysis.employment,
    analysis.clearance,
    analysis.publicTrust,
    analysis.sponsorship,
    analysis.workArrangement,
    analysis.locations,
    analysis.roleFamily,
  ];

  return [
    ...facts.flatMap((fact) => fact.evidence),
    ...analysis.experienceRequirements.flatMap((requirement) => requirement.evidence),
  ];
}

export function validateEvidenceOffsets(analysis: JobAnalysis, description: string): JobAnalysis {
  for (const evidence of allEvidence(analysis)) {
    if (description.slice(evidence.start, evidence.end) === evidence.quote) continue;
    const occurrences: number[] = [];
    let cursor = description.indexOf(evidence.quote);
    while (cursor >= 0) {
      occurrences.push(cursor);
      cursor = description.indexOf(evidence.quote, cursor + 1);
    }
    if (!occurrences.length) {
      throw new Error(`Invalid AI evidence offsets for ${evidence.field}`);
    }
    const nearest = occurrences.toSorted(
      (left, right) => Math.abs(left - evidence.start) - Math.abs(right - evidence.start),
    )[0]!;
    evidence.start = nearest;
    evidence.end = nearest + evidence.quote.length;
  }
  return analysis;
}
