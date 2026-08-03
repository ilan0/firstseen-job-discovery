import type {
  ConnectorSource,
  DiscoveryPage,
  JobConnector,
  NormalizedListing,
} from "@/connectors/types";

export async function discoverAllPages(
  connector: JobConnector,
  source: ConnectorSource,
  maxPages = 20,
): Promise<DiscoveryPage> {
  const listings: NormalizedListing[] = [];
  let cursor: string | null = null;
  let etag: string | null = null;
  let lastModified: string | null = null;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const pageSource = pageNumber === 0 ? source : { ...source, etag: null, lastModified: null };
    const page = await connector.discover(pageSource, cursor ? { cursor } : {});
    if (page.notModified) return page;
    listings.push(...page.listings);
    etag = page.etag ?? etag;
    lastModified = page.lastModified ?? lastModified;
    cursor = page.nextCursor;
    if (!cursor) return { listings, nextCursor: null, etag, lastModified, notModified: false };
  }
  throw new Error(`Connector pagination exceeded ${maxPages} pages`);
}
