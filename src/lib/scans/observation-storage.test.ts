// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { NormalizedListing } from "@/connectors/types";
import { observationStorage } from "./observation-storage";

const listing: NormalizedListing = {
  externalId: "job-1",
  requisitionId: "req-1",
  title: "Software Engineer I",
  descriptionText: "Build reliable software.",
  officialUrl: "https://jobs.example.test/job-1",
  applyUrl: "https://jobs.example.test/job-1/apply",
  locations: ["Miami, FL"],
  workplaceType: "OnSite",
  employmentType: "FullTime",
  postedAt: "2026-08-03T12:00:00Z",
  postedAtConfidence: "high",
  salaryText: null,
  sourceConfidence: "high",
  rawMetadata: { department: "Engineering" },
};

describe("raw observation retention", () => {
  it("keeps the complete normalized evidence only for work that must be processed", () => {
    expect(observationStorage(listing, false)).toMatchObject({
      responseMetadata: listing.rawMetadata,
      normalizedPayload: { title: listing.title, applyUrl: listing.applyUrl },
      sanitizedBody: listing.descriptionText,
    });
  });

  it("stores only identity evidence for unchanged listings", () => {
    expect(observationStorage(listing, true)).toEqual({
      responseMetadata: {},
      normalizedPayload: {
        externalId: listing.externalId,
        officialUrl: listing.officialUrl,
      },
      sanitizedBody: null,
    });
  });
});
