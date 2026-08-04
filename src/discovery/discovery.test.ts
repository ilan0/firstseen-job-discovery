// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { SafeGet, SafeResponse } from "@/connectors/http";
import { braveQuery, buildDiscoveryQueries } from "./queries";
import { resolveOfficialSource } from "./resolve-official";
import { AdzunaSensor } from "./sensors/adzuna";
import { BraveSensor } from "./sensors/brave";

function response(payload: unknown): SafeResponse {
  const serialized = JSON.stringify(payload);
  const body = new TextEncoder().encode(serialized);
  return {
    status: 200,
    url: "https://fixture.firstseen.test",
    headers: new Headers(),
    body,
    text: () => serialized,
    json: <T>() => JSON.parse(serialized) as T,
  };
}

describe("broad discovery queries", () => {
  it("builds all twelve role/location cohorts on every cycle", () => {
    const queries = buildDiscoveryQueries(0);

    expect(queries).toHaveLength(12);
    expect(queries).toEqual(buildDiscoveryQueries(3));
    expect(queries.filter((query) => query.remote)).toHaveLength(3);
    expect(queries.some((query) => query.locationQuery.includes("Miami"))).toBe(true);
    expect(queries.some((query) => query.locationQuery.includes("Fairfax"))).toBe(true);
    expect(queries.some((query) => query.locationQuery.includes("New York City"))).toBe(true);
    expect(queries.some((query) => query.roleQuery.includes("new grad"))).toBe(true);
    expect(queries.some((query) => query.roleQuery.includes("applied AI"))).toBe(true);
  });

  it("restricts Brave searches toward official ATS and career pages", () => {
    const query = braveQuery(buildDiscoveryQueries(0)[0]!);
    expect(query).toContain("site:jobs.lever.co");
    expect(query).toContain("site:recruitee.com");
    expect(query).toContain("site:pinpointhq.com");
  });
});

describe("Brave discovery sensor", () => {
  it("returns transient candidates rather than authoritative listings", async () => {
    const get = vi.fn<SafeGet>().mockResolvedValue(
      response({
        web: {
          results: [
            {
              title: "Software Engineer I - Example",
              url: "https://jobs.lever.co/example/job-1",
              description: "A fresh job result.",
              page_age: "2026-08-03T12:00:00Z",
              profile: { long_name: "Example" },
            },
          ],
        },
      }),
    );
    const candidates = await new BraveSensor("test-brave-key", get).search(
      buildDiscoveryQueries(0)[0]!,
    );

    expect(candidates[0]).toMatchObject({
      sensor: "brave",
      discoveredUrl: "https://jobs.lever.co/example/job-1",
      companyHint: "Example",
    });
    expect(get.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-subscription-token": "test-brave-key",
    });
    expect(candidates[0]).not.toHaveProperty("sourceConfidence");
  });
});

describe("Adzuna discovery sensor", () => {
  it("normalizes licensed job search results as candidates", async () => {
    const get = vi.fn<SafeGet>().mockResolvedValue(
      response({
        results: [
          {
            id: "adz-1",
            title: "Junior Software Engineer",
            description: "Full-time engineering role.",
            created: "2026-08-03T12:00:00Z",
            redirect_url: "https://www.adzuna.com/details/adz-1",
            company: { display_name: "Example" },
            location: { display_name: "Miami, FL" },
            contract_time: "full_time",
          },
        ],
      }),
    );
    const candidates = await new AdzunaSensor("test-id", "test-key", get).search(
      buildDiscoveryQueries(0)[0]!,
    );

    expect(candidates[0]).toMatchObject({
      sensor: "adzuna",
      sensorId: "adz-1",
      titleHint: "Junior Software Engineer",
      locationHint: "Miami, FL",
    });
  });
});

describe("official source resolution", () => {
  it.each([
    [
      "https://job-boards.greenhouse.io/acme/jobs/12345",
      { kind: "greenhouse", tenantId: "acme", externalId: "12345" },
    ],
    [
      "https://jobs.lever.co/acme/abc-123/apply",
      { kind: "lever", tenantId: "acme", externalId: "abc-123" },
    ],
    [
      "https://jobs.ashbyhq.com/acme/abc-123",
      { kind: "ashby", tenantId: "acme", externalId: "abc-123" },
    ],
    [
      "https://acme.recruitee.com/o/software-engineer-i",
      { kind: "recruitee", tenantId: "acme", externalId: "software-engineer-i" },
    ],
    [
      "https://acme.pinpointhq.com/en/postings/abc-123",
      { kind: "pinpoint", tenantId: "acme", externalId: "abc-123" },
    ],
    [
      "https://acme.com/careers/software-engineer",
      { kind: "custom_jsonld", tenantId: null, externalId: null },
    ],
    [
      "https://careers.acme.com/jobs.rss",
      { kind: "custom_feed", tenantId: null, externalId: null },
    ],
    [
      "https://careers.acme.com/job-sitemap.xml",
      { kind: "custom_sitemap", tenantId: null, externalId: null },
    ],
  ])("identifies official source %s", (url, expected) => {
    expect(resolveOfficialSource(url)).toMatchObject(expected);
  });

  it("does not bless an arbitrary aggregator URL as official", () => {
    expect(resolveOfficialSource("https://example.com/listing/123")).toBeNull();
  });

  it("rejects an aggregator ATS tenant that republishes unrelated employers", () => {
    expect(resolveOfficialSource("https://jobs.lever.co/jobgether/republished-job")).toBeNull();
  });
});
