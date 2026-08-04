import type { NormalizedListing } from "@/connectors/types";

export function observationStorage(listing: NormalizedListing, unchanged: boolean) {
  if (unchanged)
    return {
      responseMetadata: {},
      normalizedPayload: {
        externalId: listing.externalId,
        officialUrl: listing.officialUrl,
      },
      sanitizedBody: null,
    };

  return {
    responseMetadata: listing.rawMetadata,
    normalizedPayload: {
      externalId: listing.externalId,
      requisitionId: listing.requisitionId,
      title: listing.title,
      officialUrl: listing.officialUrl,
      applyUrl: listing.applyUrl,
      locations: listing.locations,
      workplaceType: listing.workplaceType,
      employmentType: listing.employmentType,
      postedAt: listing.postedAt,
      postedAtConfidence: listing.postedAtConfidence,
      salaryText: listing.salaryText,
      sourceConfidence: listing.sourceConfidence,
    },
    sanitizedBody: listing.descriptionText.slice(0, 100_000),
  };
}
