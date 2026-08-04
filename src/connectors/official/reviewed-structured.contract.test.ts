import { describe, expect, it } from "vitest";
import type { SafeGet, SafeResponse } from "../http";
import type { ConnectorSource } from "../types";
import { ReviewedFeedConnector } from "./reviewed-feed";
import { ReviewedSitemapConnector, sitemapJobUrls } from "./reviewed-sitemap";

function response(url: string, body: string, contentType: string): SafeResponse {
  const bytes = new TextEncoder().encode(body);
  return {
    status: 200,
    url,
    headers: new Headers({ "content-type": contentType, etag: '"fixture"' }),
    body: bytes,
    text: () => body,
    json: <T>() => JSON.parse(body) as T,
  };
}

describe("reviewed structured employer connectors", () => {
  it("parses same-host RSS jobs and rejects an unreviewed feed", async () => {
    const xml = `<?xml version="1.0"?><rss><channel><item>
      <guid>eng-1</guid><title>Software Engineer I</title>
      <link>https://careers.example.com/jobs/eng-1</link>
      <pubDate>Tue, 04 Aug 2026 14:00:00 GMT</pubDate>
      <description><![CDATA[<p>Full-time. One year of experience.</p>]]></description>
      <location>Miami, FL</location><employmentType>Full-time</employmentType>
    </item><item><title>Bad</title><link>https://attacker.example/jobs/1</link></item></channel></rss>`;
    const get: SafeGet = async () =>
      response("https://careers.example.com/jobs.rss", xml, "application/rss+xml");
    const connector = new ReviewedFeedConnector(get);
    const source: ConnectorSource = {
      id: "feed",
      kind: "custom_feed",
      companyName: "Example",
      baseUrl: "https://careers.example.com/jobs.rss",
      publicConfig: { reviewed: true },
    };
    const page = await connector.discover(source);
    expect(page.listings).toHaveLength(1);
    expect(page.listings[0]).toMatchObject({
      externalId: "eng-1",
      title: "Software Engineer I",
      locations: ["Miami, FL"],
      employmentType: "Full-time",
      postedAtConfidence: "medium",
    });
    await expect(connector.discover({ ...source, publicConfig: {} })).rejects.toMatchObject({
      code: "SOURCE_NOT_REVIEWED",
    });
  });

  it("filters sitemap URLs and verifies each leaf through official JSON-LD", async () => {
    const sitemap = `<?xml version="1.0"?><urlset>
      <url><loc>https://careers.example.com/jobs/eng-1</loc></url>
      <url><loc>https://careers.example.com/about</loc></url>
      <url><loc>https://attacker.example/jobs/eng-2</loc></url>
    </urlset>`;
    expect(sitemapJobUrls(sitemap, "https://careers.example.com/jobs.xml", /^\/jobs\//)).toEqual([
      "https://careers.example.com/jobs/eng-1",
    ]);
    const html = `<html><script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: "Junior Software Engineer",
      description: "Full-time. Zero to one years of experience.",
      url: "https://careers.example.com/jobs/eng-1",
      identifier: "eng-1",
      datePosted: "2026-08-04T10:00:00Z",
      employmentType: "FULL_TIME",
      jobLocation: { address: { addressLocality: "Miami", addressRegion: "FL" } },
    })}</script></html>`;
    const get: SafeGet = async (url) =>
      url.endsWith("jobs.xml")
        ? response(url, sitemap, "application/xml")
        : response(url, html, "text/html");
    const connector = new ReviewedSitemapConnector(get);
    const page = await connector.discover({
      id: "sitemap",
      kind: "custom_sitemap",
      companyName: "Example",
      baseUrl: "https://careers.example.com/jobs.xml",
      publicConfig: { reviewed: true, jobUrlPattern: "^/jobs/", maximumJobUrls: 10 },
    });
    expect(page.listings).toHaveLength(1);
    expect(page.listings[0]).toMatchObject({
      externalId: "eng-1",
      title: "Junior Software Engineer",
      locations: ["Miami, FL"],
    });
  });
});
