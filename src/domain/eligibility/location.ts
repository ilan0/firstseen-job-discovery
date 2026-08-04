import { metadataEvidence } from "./evidence";
import type { Fact, LocationEligibility, WorkArrangement } from "./types";

const southFlorida = [
  "miami",
  "miami beach",
  "coral gables",
  "doral",
  "hialeah",
  "aventura",
  "north miami",
  "kendall",
  "cutler bay",
  "homestead",
  "miramar",
  "pembroke pines",
  "hollywood",
  "fort lauderdale",
  "plantation",
  "davie",
  "weston",
  "sunrise",
  "pompano beach",
  "boca raton",
  "south florida",
  "miami-fort lauderdale",
];
const dmv = [
  "fairfax",
  "vienna",
  "tysons",
  "mclean",
  "reston",
  "herndon",
  "chantilly",
  "centreville",
  "falls church",
  "arlington",
  "alexandria",
  "washington, dc",
  "washington dc",
  "district of columbia",
  "bethesda",
  "silver spring",
  "rockville",
  "ashburn",
  "sterling",
  "manassas",
  "springfield",
  "annandale",
  "woodbridge",
  "dmv",
  "washington metropolitan area",
];
const nyc = [
  "new york, ny",
  "new york city",
  "manhattan",
  "brooklyn",
  "queens",
  "bronx",
  "staten island",
];
const newJersey = ["new jersey", "jersey city", "newark, nj", "hoboken", "secaucus"];

function containsPlace(location: string, places: string[]): boolean {
  const normalized = location.toLowerCase().replace(/\s+/g, " ").trim();
  return places.some((place) => normalized.includes(place));
}

export function extractWorkArrangement(
  workplaceType: string | null | undefined,
  description: string,
): Fact<WorkArrangement> {
  const combined = `${workplaceType ?? ""}\n${description}`;
  const checks: Array<[WorkArrangement, RegExp]> = [
    ["hybrid", /\bhybrid\b/i],
    ["onsite", /\b(?:on[- ]site|in[- ]office)\b/i],
    ["fully_remote", /\b(?:fully|100%)\s+remote\b|\bremote[- ]only\b/i],
  ];
  for (const [value, pattern] of checks) {
    const match = combined.match(pattern);
    if (match) {
      return {
        value,
        confidence: workplaceType ? "high" : "medium",
        evidence: [metadataEvidence("work_arrangement", match[0])],
      };
    }
  }
  if (/^remote$/i.test(workplaceType?.trim() ?? "")) {
    return {
      value: "fully_remote",
      confidence: "high",
      evidence: [metadataEvidence("work_arrangement", workplaceType!)],
    };
  }
  return { value: "unknown", confidence: "low", evidence: [] };
}

export function evaluateLocations(
  locations: string[],
  arrangement: WorkArrangement,
  description: string,
): Fact<LocationEligibility> {
  const evidence = locations.map((location) => metadataEvidence("location", location));
  const joined = locations.join(" | ");

  if (arrangement === "fully_remote") {
    const restrictions = `${joined}\n${description}`.toLowerCase();
    if (/\bremote\s+(?:in|within|only)\s+(?:new jersey|nj)\b/.test(restrictions)) {
      return { value: "ineligible", confidence: "high", evidence };
    }
    const compatible =
      locations.length === 0 ||
      locations.some(
        (location) =>
          /^remote$/i.test(location.trim()) ||
          /\b(?:united states|usa|u\.s\.|france)\b/i.test(location) ||
          containsPlace(location, [...southFlorida, ...dmv, ...nyc]) ||
          /\b(?:florida|virginia|washington,? dc|new york)\b/i.test(location),
      );
    if (!compatible && locations.length) {
      const explicitForeignRestriction = locations.some((location) =>
        /\b(?:canada|united kingdom|u\.?k\.?|england|scotland|wales|ireland|europe|european union|emea|india|australia|new zealand|latin america|latam|asia|apac)\b/i.test(
          location,
        ),
      );
      return explicitForeignRestriction
        ? { value: "ineligible", confidence: "high", evidence }
        : { value: "review", confidence: "medium", evidence };
    }
    return { value: "eligible", confidence: "high", evidence };
  }

  if (locations.some((location) => containsPlace(location, newJersey))) {
    return { value: "ineligible", confidence: "high", evidence };
  }
  if (locations.some((location) => containsPlace(location, [...southFlorida, ...dmv, ...nyc]))) {
    return { value: "eligible", confidence: "high", evidence };
  }
  if (locations.some((location) => /new york (?:metro|metropolitan)|tri-state/i.test(location))) {
    return { value: "review", confidence: "medium", evidence };
  }
  if (
    locations.some((location) =>
      /^(?:florida|virginia|maryland|new york|united states|usa|u\.s\.)$/i.test(location.trim()),
    )
  ) {
    return { value: "review", confidence: "medium", evidence };
  }
  if (locations.length === 0) return { value: "review", confidence: "low", evidence: [] };
  return { value: "ineligible", confidence: "high", evidence };
}
