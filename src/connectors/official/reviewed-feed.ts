import { load } from "cheerio";
import { z } from "zod";
import { ConnectorError } from "../errors";
import { safeGet, type SafeGet } from "../http";
import { headerMetadata, htmlToText } from "../normalize";
import type {
  ConnectorContext,
  ConnectorSource,
  DiscoveryPage,
  JobConnector,
  NormalizedListing,
  VerificationResult,
} from "../types";
import { connectorVersions } from "../versions";

const reviewedConfigSchema = z.object({
  reviewed: z.literal(true),
  allowedHosts: z.array(z.string().min(1)).max(5).optional(),
});

function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizedUrl(value: string, base: string, allowedHosts: string[]) {
  try {
    const url = new URL(value, base);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !allowedHosts.includes(url.hostname.toLowerCase())
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseReviewedFeed(
  xml: string,
  fetchedUrl: string,
  allowedHosts: string[],
): NormalizedListing[] {
  const $ = load(xml, { xmlMode: true });
  return $("item, entry")
    .toArray()
    .flatMap((element) => {
      const item = $(element);
      const title = item.find("title").first().text().trim();
      const rawLink =
        item.find("link[href]").first().attr("href") ?? item.find("link").first().text().trim();
      const officialUrl = rawLink ? normalizedUrl(rawLink, fetchedUrl, allowedHosts) : null;
      if (!title || !officialUrl) return [];
      const rawDescription = item
        .find("content\\:encoded, description, summary, content")
        .first()
        .text()
        .trim();
      const guid = item.find("guid, id").first().text().trim();
      const published = item.find("pubDate, published, updated, date").first().text().trim();
      const locations = item
        .find("job\\:location, location")
        .toArray()
        .map((location) => $(location).text().trim())
        .filter(Boolean);
      const employmentType = item
        .find("job\\:employmentType, employmentType")
        .first()
        .text()
        .trim();
      const salary = item.find("job\\:salary, salary").first().text().trim();
      return [
        {
          externalId: guid || officialUrl,
          requisitionId: guid || null,
          title,
          descriptionText: htmlToText(rawDescription || title),
          officialUrl,
          applyUrl: officialUrl,
          locations,
          workplaceType: /remote/i.test(locations.join(" ")) ? "Remote" : null,
          employmentType: employmentType || null,
          postedAt: published ? date(published) : null,
          postedAtConfidence: published && date(published) ? "medium" : "low",
          salaryText: salary || null,
          sourceConfidence: "medium",
          rawMetadata: { feedUrl: fetchedUrl, reviewedStructuredFeed: true },
        } satisfies NormalizedListing,
      ];
    });
}

/** Public RSS/Atom job feeds are enabled only after an explicit source review. */
export class ReviewedFeedConnector implements JobConnector {
  readonly kind = "custom_feed" as const;
  readonly version = connectorVersions.custom_feed;

  constructor(private readonly get: SafeGet = safeGet) {}

  async discover(source: ConnectorSource, context: ConnectorContext = {}): Promise<DiscoveryPage> {
    const parsedConfig = reviewedConfigSchema.safeParse(source.publicConfig);
    if (!parsedConfig.success)
      throw new ConnectorError(
        "SOURCE_NOT_REVIEWED",
        "The structured feed has not completed source review.",
        false,
      );
    const baseHost = new URL(source.baseUrl).hostname.toLowerCase();
    const allowedHosts = [...new Set([baseHost, ...(parsedConfig.data.allowedHosts ?? [])])];
    const response = await this.get(source.baseUrl, {
      allowedHosts,
      ...(context.signal ? { signal: context.signal } : {}),
      headers: {
        ...(source.etag ? { "if-none-match": source.etag } : {}),
        ...(source.lastModified ? { "if-modified-since": source.lastModified } : {}),
      },
      allowedContentTypes: [
        "application/xml",
        "application/rss+xml",
        "application/atom+xml",
        "text/xml",
      ],
    });
    const headers = headerMetadata(response.headers);
    if (response.status === 304)
      return { listings: [], nextCursor: null, ...headers, notModified: true };
    if (response.status !== 200)
      throw new ConnectorError(
        "FEED_HTTP_ERROR",
        "The reviewed employer feed returned an unexpected response.",
        false,
        response.status,
      );
    return {
      listings: parseReviewedFeed(response.text(), response.url, allowedHosts),
      nextCursor: null,
      ...headers,
      notModified: false,
    };
  }

  async verify(
    source: ConnectorSource,
    officialUrl: string,
    externalId?: string | null,
    context: ConnectorContext = {},
  ): Promise<VerificationResult> {
    const page = await this.discover({ ...source, etag: null, lastModified: null }, context);
    const listing = page.listings.find(
      (candidate) => candidate.externalId === externalId || candidate.officialUrl === officialUrl,
    );
    return listing
      ? { state: "open", listing }
      : { state: "closed", evidence: "The job is absent from the complete reviewed feed." };
  }
}
