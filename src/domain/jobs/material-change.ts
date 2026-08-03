import type { NormalizedListing } from "@/connectors/types";
import {
  normalizeOfficialUrl,
  normalizeTitle,
  normalizeWhitespace,
  sha256,
  stableJson,
} from "./normalize";

export type MaterialFields = {
  title: string;
  description: string;
  employmentType: string | null;
  locations: string[];
  workplaceType: string | null;
  salary: string | null;
  applyUrl: string;
};

export function materialFields(listing: NormalizedListing): MaterialFields {
  return {
    title: normalizeTitle(listing.title),
    description: normalizeWhitespace(listing.descriptionText),
    employmentType: listing.employmentType?.toLowerCase().trim() ?? null,
    locations: listing.locations
      .map((location) => normalizeWhitespace(location).toLowerCase())
      .sort(),
    workplaceType: listing.workplaceType?.toLowerCase().trim() ?? null,
    salary: listing.salaryText ? normalizeWhitespace(listing.salaryText).toLowerCase() : null,
    applyUrl: normalizeOfficialUrl(listing.applyUrl),
  };
}

export function materialHash(listing: NormalizedListing): string {
  return sha256(stableJson(materialFields(listing)));
}

export function materialChangeReasons(
  previous: MaterialFields | null,
  current: MaterialFields,
): Array<keyof MaterialFields> {
  if (!previous) return Object.keys(current) as Array<keyof MaterialFields>;
  return (Object.keys(current) as Array<keyof MaterialFields>).filter(
    (key) => stableJson(previous[key]) !== stableJson(current[key]),
  );
}
