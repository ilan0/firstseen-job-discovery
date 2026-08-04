// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { NormalizedListing } from "@/connectors/types";
import {
  freshness,
  jobFingerprints,
  materialChangeReasons,
  materialFields,
  materialHash,
  normalizeOfficialUrl,
  transitionLifecycle,
  normalizePostedTimestamp,
  withinPostedWindow,
  type LifecycleState,
} from ".";

const listing: NormalizedListing = {
  externalId: "job-42",
  requisitionId: "REQ-42",
  title: "Software Engineer I",
  descriptionText: "Full-time. One year of experience.",
  officialUrl: "https://jobs.lever.co/acme/job-42",
  applyUrl: "https://jobs.lever.co/acme/job-42/apply",
  locations: ["Fairfax, VA"],
  workplaceType: "Hybrid",
  employmentType: "Full-time",
  postedAt: "2026-08-03T12:00:00Z",
  postedAtConfidence: "high",
  salaryText: "$80K-$100K",
  sourceConfidence: "high",
  rawMetadata: {},
};

const openState: LifecycleState = {
  status: "open",
  consecutiveSuccessfulMisses: 0,
  possiblyClosedAt: null,
  closedAt: null,
  reopenedAt: null,
};

describe("canonical job identity", () => {
  it("prefers the official ATS tenant and external ID", () => {
    const fingerprints = jobFingerprints({
      connectorKind: "lever",
      tenantId: "acme",
      companyDomain: "acme.com",
      listing,
    });

    expect(fingerprints[0]).toMatchObject({ kind: "ats_external_id", confidence: 100 });
    expect(fingerprints.map((fingerprint) => fingerprint.kind)).toEqual([
      "ats_external_id",
      "requisition",
      "official_url",
      "fallback",
    ]);
  });

  it("normalizes tracking parameters without deleting identity parameters", () => {
    expect(
      normalizeOfficialUrl(
        "https://ACME.com/jobs/42/?utm_source=linkedin&gh_jid=42&utm_campaign=test",
      ),
    ).toBe("https://acme.com/jobs/42?gh_jid=42");
  });
});

describe("material changes", () => {
  it("ignores whitespace-only description edits", () => {
    expect(
      materialHash({ ...listing, descriptionText: " Full-time.   One year of experience. " }),
    ).toBe(materialHash(listing));
  });

  it("detects fields that require eligibility and AI reanalysis", () => {
    const previous = materialFields(listing);
    const current = materialFields({
      ...listing,
      descriptionText: "Full-time. Three years of experience.",
      locations: ["New York, NY"],
    });

    expect(materialChangeReasons(previous, current)).toEqual(["description", "locations"]);
  });
});

describe("freshness", () => {
  const now = new Date("2026-08-03T20:00:00Z");

  it("uses reliable employer-posted time", () => {
    expect(
      freshness(now, new Date("2026-08-03T12:00:00Z"), "high", new Date("2026-08-03T18:00:00Z")),
    ).toMatchObject({
      band: "very_fresh",
      section: "just_posted",
      basis: "posted_at",
      ageHours: 8,
    });
  });

  it("falls back to first seen when posted time is low confidence", () => {
    expect(
      freshness(now, new Date("2026-06-01T12:00:00Z"), "low", new Date("2026-08-03T18:00:00Z")),
    ).toMatchObject({ band: "hot", section: "just_posted", basis: "first_seen", ageHours: 2 });
  });

  it("marks jobs stale after thirty days", () => {
    expect(freshness(now, null, "low", new Date("2026-06-01T12:00:00Z")).band).toBe("stale");
  });

  it("uses a verified reopening without rewriting the original posted time", () => {
    expect(
      freshness(
        now,
        new Date("2026-01-01T12:00:00Z"),
        "high",
        new Date("2026-01-01T12:00:00Z"),
        new Date("2026-08-03T19:00:00Z"),
      ),
    ).toMatchObject({ basis: "reopened_at", ageHours: 1, section: "just_posted" });
  });

  it.each([
    [6, "6h", true],
    [6.01, "6h", false],
    [24, "24h", true],
    [24.01, "24h", false],
    [72, "3d", true],
    [72.01, "3d", false],
    [168, "7d", true],
    [168.01, "7d", false],
    [720, "30d", true],
    [720.01, "30d", false],
  ] as const)("enforces the %sh posted-window boundary", (ageHours, window, expected) => {
    expect(withinPostedWindow(ageHours, window)).toBe(expected);
  });

  it("rejects malformed and future official timestamps", () => {
    expect(normalizePostedTimestamp("not-a-date", "high", now)).toEqual({
      postedAt: null,
      confidence: "low",
      anomalous: true,
    });
    expect(normalizePostedTimestamp("2026-08-03T21:00:00Z", "high", now)).toEqual({
      postedAt: null,
      confidence: "low",
      anomalous: true,
    });
  });
});

describe("closure and reopening", () => {
  it("does not count source errors as closure evidence", () => {
    expect(transitionLifecycle(openState, "error", "greenhouse", new Date())).toEqual(openState);
  });

  it("requires two structured-source misses at least an hour apart", () => {
    const first = transitionLifecycle(
      openState,
      "missing",
      "greenhouse",
      new Date("2026-08-03T12:00:00Z"),
    );
    const tooSoon = transitionLifecycle(
      first,
      "missing",
      "greenhouse",
      new Date("2026-08-03T12:30:00Z"),
    );
    const confirmed = transitionLifecycle(
      tooSoon,
      "missing",
      "greenhouse",
      new Date("2026-08-03T13:00:00Z"),
    );

    expect(first.status).toBe("possibly_closed");
    expect(tooSoon.status).toBe("possibly_closed");
    expect(confirmed.status).toBe("closed");
  });

  it("requires three custom-source misses spanning twenty-four hours", () => {
    const first = transitionLifecycle(
      openState,
      "missing",
      "custom_jsonld",
      new Date("2026-08-03T12:00:00Z"),
    );
    const second = transitionLifecycle(
      first,
      "missing",
      "custom_jsonld",
      new Date("2026-08-03T18:00:00Z"),
    );
    const third = transitionLifecycle(
      second,
      "missing",
      "custom_jsonld",
      new Date("2026-08-04T12:00:00Z"),
    );

    expect(second.status).toBe("possibly_closed");
    expect(third.status).toBe("closed");
  });

  it("reopens a previously closed canonical job without changing identity", () => {
    const closed = transitionLifecycle(
      openState,
      "explicit_closed",
      "lever",
      new Date("2026-08-03T12:00:00Z"),
    );
    const observedAt = new Date("2026-08-10T12:00:00Z");
    const reopened = transitionLifecycle(closed, "seen", "lever", observedAt);

    expect(reopened).toMatchObject({
      status: "reopened",
      consecutiveSuccessfulMisses: 0,
      reopenedAt: observedAt,
    });
  });

  it("resets a tentative closure to open without calling it reopened", () => {
    const tentative = transitionLifecycle(
      openState,
      "missing",
      "lever",
      new Date("2026-08-03T12:00:00Z"),
    );

    expect(
      transitionLifecycle(tentative, "seen", "lever", new Date("2026-08-03T13:00:00Z")).status,
    ).toBe("open");
  });
});
