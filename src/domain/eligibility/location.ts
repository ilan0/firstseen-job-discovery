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

const areaCatalog: Record<string, string[]> = {
  "south-florida": southFlorida,
  dmv,
  nyc,
};

export type AcceptedArea = {
  id: string;
  anchor?: string | undefined;
  boroughs?: string[] | undefined;
  excludeStates?: string[] | undefined;
};

export type LocationPolicy = {
  acceptedAreas?: AcceptedArea[];
  allowFullyRemote?: boolean;
};

function areaPlaces(policy: LocationPolicy): string[] {
  const selected = policy.acceptedAreas;
  if (!selected?.length) return [...southFlorida, ...dmv, ...nyc];
  return selected.flatMap((area) => [
    ...(areaCatalog[area.id] ?? []),
    ...(area.anchor ? [area.anchor.toLowerCase().replace(/,?\s+(?:fl|va|ny)$/i, "")] : []),
    ...(area.boroughs?.map((borough) => borough.toLowerCase()) ?? []),
  ]);
}

function excludedPlaces(policy: LocationPolicy): string[] {
  const excludes = policy.acceptedAreas?.flatMap((area) => area.excludeStates ?? []) ?? ["NJ"];
  return excludes.flatMap((state) =>
    /^nj$|new jersey/i.test(state) ? newJersey : [state.toLowerCase()],
  );
}

const nonUsRegionCodes =
  `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW`.split(
    " ",
  );

function normalizeRegion(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

const regionDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });
const ambiguousRegionNames = new Set(["georgia"]);
const foreignRegionNames = [
  ...nonUsRegionCodes.map((code) => regionDisplayNames.of(code) ?? ""),
  "Africa",
  "APAC",
  "Asia",
  "EMEA",
  "England",
  "EU",
  "Europe",
  "European Union",
  "Ivory Coast",
  "Latin America",
  "LATAM",
  "Northern Ireland",
  "Oceania",
  "Scotland",
  "U.K.",
  "UK",
  "United Kingdom",
  "Wales",
]
  .map(normalizeRegion)
  .filter((name) => name && !ambiguousRegionNames.has(name));

function hasExplicitForeignRegion(location: string): boolean {
  const normalized = ` ${normalizeRegion(location)} `;
  return foreignRegionNames.some((name) => normalized.includes(` ${name} `));
}

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
  policy: LocationPolicy = {},
): Fact<LocationEligibility> {
  const evidence = locations.map((location) => metadataEvidence("location", location));
  const joined = locations.join(" | ");
  const acceptedPlaces = areaPlaces(policy);
  const excluded = excludedPlaces(policy);

  if (arrangement === "fully_remote") {
    if (policy.allowFullyRemote === false)
      return { value: "ineligible", confidence: "high", evidence };
    const restrictions = `${joined}\n${description}`.toLowerCase();
    if (
      /\bremote\s+(?:in|within|only)\s+(?:new jersey|nj)\b/.test(restrictions) ||
      locations.some((location) => containsPlace(location, excluded))
    ) {
      return { value: "ineligible", confidence: "high", evidence };
    }
    const compatible =
      locations.length === 0 ||
      locations.some(
        (location) =>
          /^remote$/i.test(location.trim()) ||
          /\b(?:united states|usa|u\.s\.)\b/i.test(location) ||
          containsPlace(location, acceptedPlaces) ||
          /\b(?:florida|virginia|washington,? dc|new york)\b/i.test(location),
      );
    if (!compatible && locations.length) {
      const explicitForeignRestriction = locations.some(hasExplicitForeignRegion);
      return explicitForeignRestriction
        ? { value: "ineligible", confidence: "high", evidence }
        : { value: "review", confidence: "medium", evidence };
    }
    return { value: "eligible", confidence: "high", evidence };
  }

  if (locations.some((location) => containsPlace(location, excluded))) {
    return { value: "ineligible", confidence: "high", evidence };
  }
  if (locations.some((location) => containsPlace(location, acceptedPlaces))) {
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
