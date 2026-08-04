import type { JobAnalysis } from "@/ai";
import { evaluateLocations, type LocationPolicy } from "./location";
import type { Evidence, ExtractedJobFacts } from "./types";

function evidence(items: JobAnalysis["employment"]["evidence"]): Evidence[] {
  return items.map((item) => ({ ...item, source: "ai_extraction" as const }));
}

export function mergeAiFacts(
  deterministic: ExtractedJobFacts,
  analysis: JobAnalysis,
  locationPolicy: LocationPolicy = {},
): ExtractedJobFacts {
  const employment =
    deterministic.employment.value === "unknown"
      ? { ...analysis.employment, evidence: evidence(analysis.employment.evidence) }
      : deterministic.employment;
  const workArrangement =
    deterministic.workArrangement.value === "unknown"
      ? { ...analysis.workArrangement, evidence: evidence(analysis.workArrangement.evidence) }
      : deterministic.workArrangement;
  const locations = deterministic.locations.value.length
    ? deterministic.locations
    : { ...analysis.locations, evidence: evidence(analysis.locations.evidence) };

  return {
    employment,
    experienceRequirements: analysis.experienceRequirements
      .filter((item) => item.minimumYears !== null && item.evidence[0])
      .map((item) => ({
        minimumYears: item.minimumYears!,
        maximumYears: item.maximumYears,
        preferred: item.kind === "preferred",
        alternativePath: item.alternativePath,
        evidence: { ...item.evidence[0]!, source: "ai_extraction" as const },
      })),
    clearance: { ...analysis.clearance, evidence: evidence(analysis.clearance.evidence) },
    publicTrust: { ...analysis.publicTrust, evidence: evidence(analysis.publicTrust.evidence) },
    sponsorship: { ...analysis.sponsorship, evidence: evidence(analysis.sponsorship.evidence) },
    workArrangement,
    locations,
    locationEligibility: evaluateLocations(
      locations.value,
      workArrangement.value,
      "",
      locationPolicy,
    ),
    roleFamily: { ...analysis.roleFamily, evidence: evidence(analysis.roleFamily.evidence) },
  };
}
