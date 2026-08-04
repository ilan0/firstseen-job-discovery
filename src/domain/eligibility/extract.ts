import { extractClearance, extractPublicTrust } from "./clearance";
import { extractEmployment } from "./employment";
import { extractExperienceRequirements } from "./experience";
import { evaluateLocations, extractWorkArrangement, type LocationPolicy } from "./location";
import { classifyRole } from "./role";
import { extractSponsorship } from "./sponsorship";
import type { ExtractedJobFacts, JobInput } from "./types";

export function extractDeterministicFacts(
  input: JobInput,
  locationPolicy: LocationPolicy = {},
): ExtractedJobFacts {
  const workArrangement = extractWorkArrangement(input.workplaceType, input.description);
  const locations = input.locations ?? [];

  return {
    employment: extractEmployment(input.employmentType, input.description),
    experienceRequirements: extractExperienceRequirements(input.description),
    clearance: extractClearance(input.description),
    publicTrust: extractPublicTrust(input.description),
    sponsorship: extractSponsorship(input.description),
    workArrangement,
    locations: {
      value: locations,
      confidence: locations.length ? "high" : "low",
      evidence: [],
    },
    locationEligibility: evaluateLocations(
      locations,
      workArrangement.value,
      input.description,
      locationPolicy,
    ),
    roleFamily: classifyRole(input.title),
  };
}
