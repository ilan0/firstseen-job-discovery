// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { SafeGet, SafeResponse } from "../http";
import type { ConnectorSource } from "../types";
import { PinpointConnector } from "./pinpoint";
import { RecruiteeConnector } from "./recruitee";

function fixtureResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): SafeResponse {
  const serialized = JSON.stringify(payload);
  const body = new TextEncoder().encode(serialized);
  return {
    status,
    url: "https://fixture.firstseen.test/jobs",
    headers: new Headers(headers),
    body,
    text: () => serialized,
    json: <T>() => JSON.parse(serialized) as T,
  };
}

function source(kind: ConnectorSource["kind"], tenantId: string): ConnectorSource {
  return {
    id: "source-public-feed",
    kind,
    companyName: "Example",
    baseUrl: `https://${tenantId}.example.test`,
    tenantId,
  };
}

function recruiteeOffer() {
  return {
    id: 1794695,
    slug: "software-engineer-i",
    status: "published",
    title: "Software Engineer I",
    description: "<p>Build reliable software.</p>",
    requirements: "<ul><li>0-2 years of experience.</li></ul>",
    location: "Miami, Florida, United States",
    locations: [{ id: 1, name: "Miami", state: "Florida", country: "United States" }],
    employment_type_code: "full_time",
    published_at: "2026-08-03 12:00:00 UTC",
    updated_at: "2026-08-03 14:00:00 UTC",
    careers_url: "https://example.recruitee.com/o/software-engineer-i",
    careers_apply_url: "https://example.recruitee.com/o/software-engineer-i/c/new",
    remote: false,
    hybrid: true,
    on_site: false,
    department: "Engineering",
  };
}

describe("Recruitee connector contract", () => {
  it("normalizes published offers and official apply URLs", async () => {
    const get = vi
      .fn<SafeGet>()
      .mockResolvedValue(
        fixtureResponse(
          200,
          { offers: [recruiteeOffer(), { ...recruiteeOffer(), id: 2, status: "closed" }] },
          { etag: '"r1"' },
        ),
      );
    const page = await new RecruiteeConnector(get).discover({
      ...source("recruitee", "example"),
      etag: '"old"',
    });

    expect(page.listings).toHaveLength(1);
    expect(page.etag).toBe('"r1"');
    expect(page.listings[0]).toMatchObject({
      externalId: "1794695",
      title: "Software Engineer I",
      locations: ["Miami", "Miami, Florida, United States"],
      workplaceType: "Hybrid",
      employmentType: "full_time",
      postedAt: "2026-08-03T12:00:00.000Z",
      postedAtConfidence: "high",
      applyUrl: "https://example.recruitee.com/o/software-engineer-i/c/new",
    });
    expect(page.listings[0]?.descriptionText).toContain("0-2 years");
    expect(get.mock.calls[0]?.[0]).toBe("https://example.recruitee.com/api/offers/");
    expect(get.mock.calls[0]?.[1]?.headers).toMatchObject({ "if-none-match": '"old"' });
  });

  it("supports conditional, malformed, closed, and open verification outcomes", async () => {
    await expect(
      new RecruiteeConnector(vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(304, {}))).discover(
        source("recruitee", "example"),
      ),
    ).resolves.toMatchObject({ notModified: true, listings: [] });
    await expect(
      new RecruiteeConnector(
        vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(200, { offers: [{ id: 1 }] })),
      ).discover(source("recruitee", "example")),
    ).rejects.toMatchObject({ code: "RECRUITEE_SCHEMA_ERROR" });
    await expect(
      new RecruiteeConnector(vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(404, {}))).verify(
        source("recruitee", "example"),
        "https://example.test",
        "1794695",
      ),
    ).resolves.toMatchObject({ state: "closed" });
    await expect(
      new RecruiteeConnector(
        vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(200, { offer: recruiteeOffer() })),
      ).verify(source("recruitee", "example"), "https://example.test", "1794695"),
    ).resolves.toMatchObject({ state: "open" });
  });
});

function pinpointPosting() {
  return {
    id: "520855",
    title: "Product Reliability Engineer",
    description: "<p>Build product systems.</p>",
    key_responsibilities: "<ul><li>Ship reliable code.</li></ul>",
    skills_knowledge_expertise: "<p>TypeScript and SQL.</p>",
    benefits: null,
    employment_type: "full_time",
    employment_type_text: "Full Time",
    workplace_type: "remote",
    workplace_type_text: "Fully remote",
    compensation: "£55,000 - £65,000 / year",
    compensation_visible: true,
    deadline_at: null,
    url: "https://workwithus.pinpointhq.com/en/postings/job-uuid",
    location: { id: "283", name: "Remote", city: "London", province: "London" },
    job: {
      id: "526751",
      requisition_id: "PIN-0395",
      department: { id: "190", name: "Engineering" },
      division: null,
    },
  };
}

describe("Pinpoint connector contract", () => {
  it("uses the documented postings feed and first-sighting timestamp fallback", async () => {
    const get = vi
      .fn<SafeGet>()
      .mockResolvedValue(
        fixtureResponse(200, { data: [pinpointPosting()] }, { "last-modified": "today" }),
      );
    const page = await new PinpointConnector(get).discover(source("pinpoint", "workwithus"));

    expect(get.mock.calls[0]?.[0]).toBe("https://workwithus.pinpointhq.com/postings.json");
    expect(page.listings[0]).toMatchObject({
      externalId: "520855",
      requisitionId: "PIN-0395",
      locations: ["Remote"],
      workplaceType: "Fully remote",
      employmentType: "Full Time",
      postedAt: null,
      postedAtConfidence: "low",
      sourceConfidence: "high",
    });
    expect(page.listings[0]?.descriptionText).toContain("TypeScript and SQL");
  });

  it("closes only after absence from a successful complete feed", async () => {
    const open = new PinpointConnector(
      vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(200, { data: [pinpointPosting()] })),
    );
    await expect(
      open.verify(
        source("pinpoint", "workwithus"),
        "https://workwithus.pinpointhq.com/en/postings/job-uuid",
        "different-id",
      ),
    ).resolves.toMatchObject({ state: "open" });

    const missing = new PinpointConnector(
      vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(200, { data: [] })),
    );
    await expect(
      missing.verify(source("pinpoint", "workwithus"), "https://example.test", "520855"),
    ).resolves.toMatchObject({ state: "closed" });
  });
});
