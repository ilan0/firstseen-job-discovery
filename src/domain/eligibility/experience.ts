import { evidenceFromMatch } from "./evidence";
import type { ExperienceRequirement } from "./types";

const experiencePattern =
  /\b(\d{1,2})(?:\s*(?:-|–|—|to)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+(?:professional|relevant|related|industry|software(?:\s+development)?))?\s+experience\b/gi;
const preferredMarkers =
  /\b(preferred|ideally|desired|nice[- ]to[- ]have|bonus|a plus|would be a plus)\b/i;
const alternativeMarkers =
  /\b(or equivalent|in lieu of|degree may substitute|or a (?:bachelor|master|phd))\b/i;

function sectionBefore(text: string, offset: number): string {
  const before = text.slice(0, offset);
  const headingPattern =
    /(?:^|\n)\s*(preferred qualifications?|nice to have|bonus|desired qualifications?|minimum qualifications?|required qualifications?|requirements?)\s*:?[ \t]*$/gim;
  let latest = "";
  for (let match = headingPattern.exec(before); match; match = headingPattern.exec(before)) {
    latest = match[1] ?? "";
  }
  return latest;
}

export function extractExperienceRequirements(description: string): ExperienceRequirement[] {
  const requirements: ExperienceRequirement[] = [];
  experiencePattern.lastIndex = 0;

  for (
    let match = experiencePattern.exec(description);
    match;
    match = experiencePattern.exec(description)
  ) {
    const minimumYears = Number(match[1]);
    const maximumYears = match[2] ? Number(match[2]) : null;
    const lineStart = description.lastIndexOf("\n", match.index - 1) + 1;
    const nextBreak = description.indexOf("\n", match.index + match[0].length);
    const line = description.slice(lineStart, nextBreak === -1 ? description.length : nextBreak);
    const section = sectionBefore(description, match.index);
    const preferred = preferredMarkers.test(line) || preferredMarkers.test(section);
    const alternativePath = alternativeMarkers.test(line);

    requirements.push({
      minimumYears,
      maximumYears,
      preferred,
      alternativePath,
      evidence: evidenceFromMatch("experience", description, match),
    });
  }

  return requirements;
}
