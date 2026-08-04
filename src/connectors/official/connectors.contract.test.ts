// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { SafeGet, SafeResponse } from "../http";
import type { ConnectorSource } from "../types";
import { AshbyConnector } from "./ashby";
import { GreenhouseConnector } from "./greenhouse";
import { JsonLdConnector } from "./jsonld";
import { LeverConnector } from "./lever";

function fixtureResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): SafeResponse {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
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

function source(kind: ConnectorSource["kind"], tenantId = "example"): ConnectorSource {
  return {
    id: "source-1",
    kind,
    companyName: "Example",
    baseUrl: "https://example.com/careers",
    tenantId,
  };
}

describe("Greenhouse connector contract", () => {
  it("normalizes official jobs and preserves conditional metadata", async () => {
    const get = vi.fn<SafeGet>().mockResolvedValue(
      fixtureResponse(
        200,
        {
          jobs: [
            {
              id: 42,
              internal_job_id: 99,
              requisition_id: "SWE-42",
              title: "Software Engineer I",
              location: { name: "New York, NY" },
              absolute_url: "https://boards.greenhouse.io/example/jobs/42",
              content: "<p>Full-time role.</p><p>1 year of experience.</p>",
              updated_at: "2026-08-03T12:00:00Z",
            },
          ],
        },
        { etag: '"fixture"', "last-modified": "Mon, 03 Aug 2026 12:00:00 GMT" },
      ),
    );
    const connector = new GreenhouseConnector(get);

    const page = await connector.discover({ ...source("greenhouse"), etag: '"old"' });

    expect(page.etag).toBe('"fixture"');
    expect(page.listings[0]).toMatchObject({
      externalId: "42",
      requisitionId: "SWE-42",
      title: "Software Engineer I",
      locations: ["New York, NY"],
      sourceConfidence: "high",
    });
    expect(page.listings[0]?.descriptionText).toContain("1 year of experience.");
    expect(get.mock.calls[0]?.[1]?.headers).toMatchObject({ "if-none-match": '"old"' });
  });

  it("treats an official 404 verification as closed", async () => {
    const connector = new GreenhouseConnector(
      vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(404, {})),
    );

    await expect(
      connector.verify(source("greenhouse"), "https://example.com/jobs/42", "42"),
    ).resolves.toMatchObject({
      state: "closed",
    });
  });

  it("rejects a malformed provider response", async () => {
    const connector = new GreenhouseConnector(
      vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(200, { jobs: [{ id: 42 }] })),
    );

    await expect(connector.discover(source("greenhouse"))).rejects.toMatchObject({
      code: "GREENHOUSE_SCHEMA_ERROR",
    });
  });

  it("handles conditional discovery and all verification outcomes", async () => {
    const notModified = new GreenhouseConnector(
      vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(304, {})),
    );
    await expect(notModified.discover(source("greenhouse"))).resolves.toMatchObject({
      notModified: true,
      listings: [],
    });
    const unexpected = new GreenhouseConnector(
      vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(418, {})),
    );
    await expect(unexpected.discover(source("greenhouse"))).rejects.toMatchObject({
      code: "GREENHOUSE_HTTP_ERROR",
      status: 418,
      retryable: false,
    });
    await expect(
      new GreenhouseConnector(
        vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(503, {})),
      ).discover(source("greenhouse")),
    ).rejects.toMatchObject({ code: "GREENHOUSE_HTTP_ERROR", retryable: true });
    await expect(
      unexpected.verify(source("greenhouse"), "https://example.com", null),
    ).resolves.toMatchObject({ state: "uncertain" });
    await expect(
      unexpected.verify(source("greenhouse"), "https://example.com", "42"),
    ).resolves.toMatchObject({ state: "uncertain" });
  });
});

describe("Lever connector contract", () => {
  function posting(index: number) {
    return {
      id: `posting-${index}`,
      text: `Software Engineer ${index}`,
      categories: {
        location: "Miami, FL",
        allLocations: ["Miami, FL", "Remote"],
        commitment: "Full-time",
        team: "Engineering",
      },
      descriptionPlain: "Build software. 1 year of experience.",
      additionalPlain: "Benefits included.",
      hostedUrl: `https://jobs.lever.co/example/posting-${index}`,
      applyUrl: `https://jobs.lever.co/example/posting-${index}/apply`,
      workplaceType: "hybrid",
    };
  }

  it("paginates at the documented limit and keeps official apply URLs", async () => {
    const get = vi.fn<SafeGet>().mockResolvedValue(
      fixtureResponse(
        200,
        Array.from({ length: 100 }, (_, index) => posting(index)),
      ),
    );
    const page = await new LeverConnector(get).discover(source("lever"));

    expect(page.listings).toHaveLength(100);
    expect(page.nextCursor).toBe("100");
    expect(page.listings[0]).toMatchObject({
      employmentType: "Full-time",
      workplaceType: "hybrid",
      applyUrl: "https://jobs.lever.co/example/posting-0/apply",
      locations: ["Miami, FL", "Remote"],
    });
  });

  it("uses the cursor as Lever's skip parameter", async () => {
    const get = vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(200, []));

    await new LeverConnector(get).discover(source("lever"), { cursor: "100" });

    expect(get.mock.calls[0]?.[0]).toContain("skip=100&limit=100");
  });

  it("normalizes fallback fields, EU routing, salary ranges, and created dates", async () => {
    const item = posting(1);
    const get = vi.fn<SafeGet>().mockResolvedValue(
      fixtureResponse(200, [
        {
          ...item,
          categories: { location: "New York, NY", commitment: "Full-time" },
          descriptionPlain: undefined,
          description: "<p>Build products.</p>",
          salaryRange: { currency: "USD", min: 80_000, max: 100_000, interval: "year" },
          createdAt: 1_786_000_000_000,
        },
      ]),
    );
    const page = await new LeverConnector(get).discover({
      ...source("lever"),
      publicConfig: { region: "eu" },
    });
    expect(get.mock.calls[0]?.[0]).toContain("api.eu.lever.co");
    expect(page.listings[0]).toMatchObject({
      locations: ["New York, NY"],
      salaryText: "USD 80000-100000 year",
      postedAtConfidence: "medium",
    });
    expect(page.listings[0]?.descriptionText).toContain("Build products.");
  });

  it("handles conditional, invalid, and verification responses", async () => {
    await expect(
      new LeverConnector(vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(304, []))).discover(
        source("lever"),
      ),
    ).resolves.toMatchObject({ notModified: true });
    await expect(
      new LeverConnector(vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(418, []))).discover(
        source("lever"),
      ),
    ).rejects.toMatchObject({ code: "LEVER_HTTP_ERROR", retryable: false });
    await expect(
      new LeverConnector(vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(429, []))).discover(
        source("lever"),
      ),
    ).rejects.toMatchObject({ code: "LEVER_HTTP_ERROR", retryable: true });
    const malformed = new LeverConnector(
      vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(200, [{ id: "bad" }])),
    );
    await expect(malformed.discover(source("lever"))).rejects.toMatchObject({
      code: "LEVER_SCHEMA_ERROR",
    });
    await expect(
      malformed.verify(source("lever"), "https://example.com", "bad/id"),
    ).resolves.toMatchObject({ state: "uncertain" });
    await expect(
      new LeverConnector(vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(410, {}))).verify(
        source("lever"),
        "https://example.com",
        "posting-1",
      ),
    ).resolves.toMatchObject({ state: "closed" });
  });
});

describe("Ashby connector contract", () => {
  it("normalizes primary and secondary locations and compensation", async () => {
    const get = vi.fn<SafeGet>().mockResolvedValue(
      fixtureResponse(200, {
        apiVersion: "1",
        jobs: [
          {
            title: "AI Engineer",
            location: "Fairfax, VA",
            secondaryLocations: [{ location: "New York, NY" }],
            isListed: true,
            isRemote: false,
            workplaceType: "Hybrid",
            descriptionPlain: "Full-time. Build reliable AI systems.",
            publishedAt: "2026-08-03T12:00:00+00:00",
            employmentType: "FullTime",
            jobUrl: "https://jobs.ashbyhq.com/example/job-42",
            applyUrl: "https://jobs.ashbyhq.com/example/job-42/application",
            compensation: { scrapeableCompensationSalarySummary: "$80K - $100K" },
          },
        ],
      }),
    );

    const page = await new AshbyConnector(get).discover(source("ashby"));

    expect(page.listings[0]).toMatchObject({
      externalId: "job-42",
      locations: ["Fairfax, VA", "New York, NY"],
      salaryText: "$80K - $100K",
      postedAtConfidence: "high",
    });
  });

  it("reports absence from a successful board response as closure evidence", async () => {
    const get = vi
      .fn<SafeGet>()
      .mockResolvedValue(fixtureResponse(200, { apiVersion: "1", jobs: [] }));

    await expect(
      new AshbyConnector(get).verify(
        source("ashby"),
        "https://jobs.ashbyhq.com/example/missing",
        "missing",
      ),
    ).resolves.toMatchObject({ state: "closed" });
  });

  it("filters unlisted jobs and handles fallback remote and compensation fields", async () => {
    const payload = {
      apiVersion: "1",
      jobs: [
        {
          title: "Hidden",
          isListed: false,
          descriptionPlain: "Hidden",
          jobUrl: "https://jobs.ashbyhq.com/example/hidden",
          applyUrl: "https://jobs.ashbyhq.com/example/hidden/apply",
        },
        {
          title: "Remote Engineer",
          location: "",
          isRemote: true,
          descriptionPlain: "Build software.",
          jobUrl: "https://jobs.ashbyhq.com/example/remote",
          applyUrl: "https://jobs.ashbyhq.com/example/remote/apply",
          compensation: { compensationTierSummary: "Tier A" },
        },
        {
          title: "Legacy workplace metadata",
          location: "Miami, FL",
          isRemote: null,
          workplaceType: null,
          descriptionPlain: "Build software.",
          jobUrl: "https://jobs.ashbyhq.com/example/legacy",
          applyUrl: "https://jobs.ashbyhq.com/example/legacy/apply",
        },
      ],
    };
    const page = await new AshbyConnector(
      vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(200, payload)),
    ).discover(source("ashby"));
    expect(page.listings).toHaveLength(2);
    expect(page.listings[0]).toMatchObject({
      workplaceType: "Remote",
      salaryText: "Tier A",
      locations: [],
    });
    expect(page.listings[1]).toMatchObject({
      workplaceType: null,
      locations: ["Miami, FL"],
    });
  });

  it("handles conditional and invalid board responses", async () => {
    await expect(
      new AshbyConnector(vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(304, {}))).discover(
        source("ashby"),
      ),
    ).resolves.toMatchObject({ notModified: true });
    await expect(
      new AshbyConnector(vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(418, {}))).discover(
        source("ashby"),
      ),
    ).rejects.toMatchObject({ code: "ASHBY_HTTP_ERROR", retryable: false });
    await expect(
      new AshbyConnector(vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(404, {}))).discover(
        source("ashby"),
      ),
    ).rejects.toMatchObject({ code: "ASHBY_BOARD_NOT_FOUND", retryable: false, status: 404 });
    await expect(
      new AshbyConnector(vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(500, {}))).discover(
        source("ashby"),
      ),
    ).rejects.toMatchObject({ code: "ASHBY_HTTP_ERROR", retryable: true });
    await expect(
      new AshbyConnector(
        vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(200, { jobs: [] })),
      ).discover(source("ashby")),
    ).rejects.toMatchObject({ code: "ASHBY_SCHEMA_ERROR" });
  });
});

describe("JSON-LD connector contract", () => {
  it("extracts a public schema.org JobPosting", async () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Junior Software Engineer",
      description: "<p>Full-time. No clearance required.</p>",
      identifier: { value: "REQ-7" },
      datePosted: "2026-08-03",
      employmentType: "FULL_TIME",
      jobLocation: { address: { addressLocality: "Miami", addressRegion: "FL" } },
      url: "https://example.com/jobs/req-7",
    })}</script></head></html>`;
    const connector = new JsonLdConnector(
      vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(200, html)),
    );

    const page = await connector.discover(source("custom_jsonld", ""));

    expect(page.listings[0]).toMatchObject({
      externalId: "REQ-7",
      title: "Junior Software Engineer",
      locations: ["Miami, FL"],
      employmentType: "FULL_TIME",
    });
  });

  it("ignores cross-origin structured URLs and malformed posting dates", async () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Software Engineer",
      description: "Full-time role.",
      datePosted: "not-a-date",
      url: "https://attacker.example/collect",
    })}</script>`;
    const connector = new JsonLdConnector(
      vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(200, html)),
    );

    const page = await connector.discover(source("custom_jsonld", ""));

    expect(page.listings[0]).toMatchObject({
      officialUrl: "https://fixture.firstseen.test/jobs",
      postedAt: null,
      postedAtConfidence: "low",
    });
  });

  it("refuses verification outside the reviewed employer hostname", async () => {
    const get = vi.fn<SafeGet>();
    const result = await new JsonLdConnector(get).verify(
      source("custom_jsonld", ""),
      "https://attacker.example/jobs/1",
      "1",
    );

    expect(result.state).toBe("uncertain");
    expect(get).not.toHaveBeenCalled();
  });

  it("flattens graphs, ignores malformed blocks, and normalizes optional schema fields", async () => {
    const posting = {
      "@type": ["Thing", "JobPosting"],
      title: "Remote Software Engineer",
      description: "<p>Full-time role.</p>",
      identifier: "REQ-GRAPH",
      datePosted: "2026-08-03",
      employmentType: ["FULL_TIME", "PERMANENT"],
      jobLocationType: "TELECOMMUTE",
      jobLocation: [
        { name: "Remote - US" },
        {
          address: {
            addressLocality: "Miami",
            addressRegion: "FL",
            addressCountry: { name: "US" },
          },
        },
      ],
    };
    const html = `<script type="application/ld+json">invalid</script><script type="application/ld+json">${JSON.stringify({ "@graph": [posting] })}</script>`;
    const page = await new JsonLdConnector(
      vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(200, html)),
    ).discover(source("custom_jsonld", ""));
    expect(page.listings[0]).toMatchObject({
      externalId: "REQ-GRAPH",
      workplaceType: "Remote",
      employmentType: "FULL_TIME, PERMANENT",
      locations: ["Remote - US", "Miami, FL, US"],
    });
  });

  it("handles conditional, missing posting, and verification states", async () => {
    await expect(
      new JsonLdConnector(vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(304, ""))).discover(
        source("custom_jsonld", ""),
      ),
    ).resolves.toMatchObject({ notModified: true });
    await expect(
      new JsonLdConnector(vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(418, ""))).discover(
        source("custom_jsonld", ""),
      ),
    ).rejects.toMatchObject({ code: "JSONLD_HTTP_ERROR" });
    const empty = new JsonLdConnector(
      vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(200, "<html></html>")),
    );
    await expect(empty.discover(source("custom_jsonld", ""))).rejects.toMatchObject({
      code: "JOBPOSTING_NOT_FOUND",
    });
    await expect(
      new JsonLdConnector(vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(404, ""))).verify(
        source("custom_jsonld", ""),
        "https://example.com/jobs/1",
        "1",
      ),
    ).resolves.toMatchObject({ state: "closed" });
    await expect(
      new JsonLdConnector(vi.fn<SafeGet>().mockResolvedValue(fixtureResponse(500, ""))).verify(
        source("custom_jsonld", ""),
        "https://example.com/jobs/1",
        "1",
      ),
    ).resolves.toMatchObject({ state: "uncertain" });
    await expect(
      empty.verify(source("custom_jsonld", ""), "https://example.com/jobs/1", "1"),
    ).resolves.toMatchObject({ state: "uncertain" });
  });
});
