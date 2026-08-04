import { load } from "cheerio";
import { z } from "zod";
import { ConnectorError } from "../errors";
import { safeGet, type SafeGet } from "../http";
import { headerMetadata } from "../normalize";
import type {
  ConnectorContext,
  ConnectorSource,
  DiscoveryPage,
  JobConnector,
  NormalizedListing,
  VerificationResult,
} from "../types";
import { connectorVersions } from "../versions";
import { JsonLdConnector } from "./jsonld";

const sitemapConfigSchema = z.object({
  reviewed: z.literal(true),
  jobUrlPattern: z.string().min(1).max(200),
  maximumJobUrls: z.number().int().min(1).max(100).default(100),
});

export function sitemapJobUrls(xml: string, sitemapUrl: string, pattern: RegExp) {
  const sitemapHost = new URL(sitemapUrl).hostname.toLowerCase();
  const $ = load(xml, { xmlMode: true });
  return $("url > loc")
    .toArray()
    .map((element) => $(element).text().trim())
    .flatMap((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.port &&
          url.hostname.toLowerCase() === sitemapHost &&
          pattern.test(url.pathname)
          ? [url.toString()]
          : [];
      } catch {
        return [];
      }
    })
    .filter((value, index, all) => all.indexOf(value) === index);
}

/**
 * A reviewed sitemap discovers leaf URLs; each leaf must independently expose
 * valid official JobPosting JSON-LD before it enters canonical supply.
 */
export class ReviewedSitemapConnector implements JobConnector {
  readonly kind = "custom_sitemap" as const;
  readonly version = connectorVersions.custom_sitemap;

  constructor(private readonly get: SafeGet = safeGet) {}

  async discover(source: ConnectorSource, context: ConnectorContext = {}): Promise<DiscoveryPage> {
    const config = sitemapConfigSchema.safeParse(source.publicConfig);
    if (!config.success)
      throw new ConnectorError(
        "SOURCE_NOT_REVIEWED",
        "The job sitemap has not completed source review.",
        false,
      );
    let pattern: RegExp;
    try {
      pattern = new RegExp(config.data.jobUrlPattern, "i");
    } catch {
      throw new ConnectorError(
        "INVALID_JOB_URL_PATTERN",
        "The reviewed sitemap job URL pattern is invalid.",
        false,
      );
    }
    const hostname = new URL(source.baseUrl).hostname.toLowerCase();
    const response = await this.get(source.baseUrl, {
      allowedHosts: [hostname],
      ...(context.signal ? { signal: context.signal } : {}),
      headers: {
        ...(source.etag ? { "if-none-match": source.etag } : {}),
        ...(source.lastModified ? { "if-modified-since": source.lastModified } : {}),
      },
      allowedContentTypes: ["application/xml", "text/xml"],
    });
    const headers = headerMetadata(response.headers);
    if (response.status === 304)
      return { listings: [], nextCursor: null, ...headers, notModified: true };
    if (response.status !== 200)
      throw new ConnectorError(
        "SITEMAP_HTTP_ERROR",
        "The reviewed employer sitemap returned an unexpected response.",
        false,
        response.status,
      );
    const urls = sitemapJobUrls(response.text(), response.url, pattern);
    if (urls.length > config.data.maximumJobUrls)
      throw new ConnectorError(
        "SITEMAP_LIMIT_EXCEEDED",
        "The sitemap exceeded its reviewed job URL bound.",
        false,
      );
    const jsonLd = new JsonLdConnector(this.get);
    const listings: NormalizedListing[] = [];
    for (const url of urls) {
      const page = await jsonLd.discover(
        {
          ...source,
          kind: "custom_jsonld",
          baseUrl: url,
          etag: null,
          lastModified: null,
        },
        context,
      );
      listings.push(
        ...page.listings.filter(
          (listing) => new URL(listing.officialUrl).hostname.toLowerCase() === hostname,
        ),
      );
    }
    return { listings, nextCursor: null, ...headers, notModified: false };
  }

  async verify(
    source: ConnectorSource,
    officialUrl: string,
    externalId?: string | null,
    context: ConnectorContext = {},
  ): Promise<VerificationResult> {
    if (new URL(officialUrl).hostname !== new URL(source.baseUrl).hostname)
      return { state: "uncertain", evidence: "The job URL left the reviewed employer host." };
    return new JsonLdConnector(this.get).verify(
      { ...source, kind: "custom_jsonld", baseUrl: officialUrl },
      officialUrl,
      externalId,
      context,
    );
  }
}
