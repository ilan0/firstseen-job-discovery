import { evidenceFromMatch } from "./evidence";
import type { ExperienceRequirement } from "./types";

const year = "(\\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten)";
const experiencePatterns = [
  new RegExp(
    `\\b(?:(?:more than|over)[ \\t]+)?${year}(?:\\s*(?:-|–|—|to)\\s*${year})?\\s*(?:\\+|or more)?\\s*(?:years?|yrs?)[’']?(?:[ \\t]+of)?(?:[ \\t]+[a-z][a-z0-9+&/.-]*){0,6}[ \\t]+experience\\b`,
    "gi",
  ),
  new RegExp(
    `\\b(?:(?:more than|over)[ \\t]+)?${year}(?:\\s*(?:-|–|—|to)\\s*${year})?\\s*(?:\\+|or more)?\\s*(?:years?|yrs?)[’']?[ \\t]+(?:in|building|developing|working|managing|leading|designing|creating|shipping|with)\\b`,
    "gi",
  ),
];
const preferredMarkers =
  /\b(preferred|ideally|desired|nice[- ]to[- ]have|bonus|a plus|would be a plus)\b/i;
const alternativeMarkers =
  /\b(in lieu of|degree may substitute|or (?:a )?(?:bachelor|master|phd)(?:'s)?(?: degree)?)\b/i;

const wordYears: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function years(value: string | undefined): number | null {
  if (!value) return null;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? (wordYears[value.toLowerCase()] ?? null) : numeric;
}

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

function describesEmployerHistory(line: string, matchOffset: number): boolean {
  const before = line.slice(0, matchOffset).trim();
  if (
    /(?:^|\b)(?:we(?:'ve| have)|(?:our|the)\s+[a-z -]{0,40}\b(?:has|have|brings?))\s*$/i.test(
      before,
    )
  )
    return true;
  const sentenceStart = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf("!"),
    before.lastIndexOf("?"),
  );
  const clauseBefore = before.slice(sentenceStart + 1).trim();
  return /^with$/i.test(clauseBefore) && /,\s*(?:we|our|the company|the team)\b/i.test(line);
}

export function extractExperienceRequirements(description: string): ExperienceRequirement[] {
  const requirements: ExperienceRequirement[] = [];
  const seen = new Set<string>();

  for (const pattern of experiencePatterns) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(description); match; match = pattern.exec(description)) {
      const statedMinimumYears = years(match[1]);
      if (statedMinimumYears === null) continue;
      const minimumYears = /^(?:more than|over)\b/i.test(match[0])
        ? statedMinimumYears + 1
        : statedMinimumYears;
      const maximumYears = years(match[2]);
      const key = `${match.index}:${minimumYears}:${maximumYears ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lineStart = description.lastIndexOf("\n", match.index - 1) + 1;
      const nextBreak = description.indexOf("\n", match.index + match[0].length);
      const line = description.slice(lineStart, nextBreak === -1 ? description.length : nextBreak);
      if (describesEmployerHistory(line, match.index - lineStart)) continue;
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
  }

  return requirements.sort((a, b) => a.evidence.start - b.evidence.start);
}
