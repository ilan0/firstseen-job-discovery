import { load } from "cheerio";
import { z } from "zod";
import { ConnectorError } from "../errors";
import { safeGet, type SafeGet } from "../http";
import { headerMetadata, htmlToText, idFromUrl } from "../normalize";
import type {
  ConnectorContext,
  ConnectorSource,
  DiscoveryPage,
  JobConnector,
  NormalizedListing,
  VerificationResult,
} from "../types";
import { connectorVersions } from "../versions";

const addressSchema = z
  .object({
    addressLocality: z.string().optional(),
    addressRegion: z.string().optional(),
    addressCountry: z.union([z.string(), z.object({ name: z.string().optional() })]).optional(),
  })
  .passthrough();
const jobLocationSchema = z
  .object({
    address: addressSchema.optional(),
    name: z.string().optional(),
  })
  .passthrough();
const jobPostingSchema = z
  .object({
    "@type": z.union([z.literal("JobPosting"), z.array(z.string())]),
    title: z.string(),
    description: z.string(),
    url: z.string().url().optional(),
    identifier: z
      .union([
        z.string(),
        z.object({ value: z.union([z.string(), z.number()]).optional() }).passthrough(),
      ])
      .optional(),
    datePosted: z.string().optional(),
    validThrough: z.string().optional(),
    employmentType: z.union([z.string(), z.array(z.string())]).optional(),
    jobLocationType: z.string().optional(),
    jobLocation: z.union([jobLocationSchema, z.array(jobLocationSchema)]).optional(),
    applicantLocationRequirements: z.unknown().optional(),
    baseSalary: z.unknown().optional(),
  })
  .passthrough();

function flattenJsonLd(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [value, ...(object["@graph"] ? flattenJsonLd(object["@graph"]) : [])];
}

function locationName(location: z.infer<typeof jobLocationSchema>): string | null {
  if (location.name) return location.name;
  const address = location.address;
  if (!address) return null;
  const country =
    typeof address.addressCountry === "string"
      ? address.addressCountry
      : address.addressCountry?.name;
  return (
    [address.addressLocality, address.addressRegion, country].filter(Boolean).join(", ") || null
  );
}

function identifier(job: z.infer<typeof jobPostingSchema>, officialUrl: string): string | null {
  if (typeof job.identifier === "string") return job.identifier;
  if (job.identifier?.value !== undefined) return String(job.identifier.value);
  return idFromUrl(job.url ?? officialUrl);
}

function normalize(job: z.infer<typeof jobPostingSchema>, fetchedUrl: string): NormalizedListing {
  let officialUrl = fetchedUrl;
  if (job.url) {
    try {
      if (new URL(job.url).hostname === new URL(fetchedUrl).hostname) officialUrl = job.url;
    } catch {
      /* The fetched page remains authoritative. */
    }
  }
  const rawLocations = job.jobLocation
    ? Array.isArray(job.jobLocation)
      ? job.jobLocation
      : [job.jobLocation]
    : [];
  const employment = Array.isArray(job.employmentType)
    ? job.employmentType.join(", ")
    : (job.employmentType ?? null);
  return {
    externalId: identifier(job, officialUrl),
    requisitionId: identifier(job, officialUrl),
    title: job.title.trim(),
    descriptionText: htmlToText(job.description),
    officialUrl,
    applyUrl: officialUrl,
    locations: rawLocations.map(locationName).filter((value): value is string => Boolean(value)),
    workplaceType: job.jobLocationType === "TELECOMMUTE" ? "Remote" : null,
    employmentType: employment,
    postedAt:
      job.datePosted && !Number.isNaN(new Date(job.datePosted).getTime())
        ? new Date(job.datePosted).toISOString()
        : null,
    postedAtConfidence:
      job.datePosted && !Number.isNaN(new Date(job.datePosted).getTime()) ? "high" : "low",
    salaryText: null,
    sourceConfidence: "medium",
    rawMetadata: {
      validThrough: job.validThrough ?? null,
      applicantLocationRequirements: job.applicantLocationRequirements ?? null,
      baseSalary: job.baseSalary ?? null,
    },
  };
}

function parsePostings(html: string, fetchedUrl: string): NormalizedListing[] {
  const $ = load(html);
  const values: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      values.push(...flattenJsonLd(JSON.parse($(element).text())));
    } catch {
      // Ignore one malformed block while continuing to evaluate other public structured data.
    }
  });
  return values.flatMap((value) => {
    const parsed = jobPostingSchema.safeParse(value);
    return parsed.success ? [normalize(parsed.data, fetchedUrl)] : [];
  });
}

export class JsonLdConnector implements JobConnector {
  readonly kind = "custom_jsonld" as const;
  readonly version = connectorVersions.custom_jsonld;

  constructor(private readonly get: SafeGet = safeGet) {}

  async discover(source: ConnectorSource, context: ConnectorContext = {}): Promise<DiscoveryPage> {
    const hostname = new URL(source.baseUrl).hostname;
    const response = await this.get(source.baseUrl, {
      allowedHosts: [hostname],
      ...(context.signal ? { signal: context.signal } : {}),
      headers: {
        ...(source.etag ? { "if-none-match": source.etag } : {}),
        ...(source.lastModified ? { "if-modified-since": source.lastModified } : {}),
      },
    });
    const headers = headerMetadata(response.headers);
    if (response.status === 304)
      return { listings: [], nextCursor: null, ...headers, notModified: true };
    if (response.status !== 200) {
      throw new ConnectorError(
        "JSONLD_HTTP_ERROR",
        "The employer page returned an unexpected response.",
        false,
        response.status,
      );
    }
    const listings = parsePostings(response.text(), response.url);
    if (!listings.length) {
      throw new ConnectorError(
        "JOBPOSTING_NOT_FOUND",
        "No valid public JobPosting data was found.",
        false,
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
    const hostname = new URL(source.baseUrl).hostname;
    if (new URL(officialUrl).hostname !== hostname)
      return { state: "uncertain", evidence: "The job URL left the reviewed employer hostname." };
    const response = await this.get(officialUrl, {
      allowedHosts: [hostname],
      ...(context.signal ? { signal: context.signal } : {}),
    });
    if ([404, 410].includes(response.status))
      return { state: "closed", evidence: `Official page returned ${response.status}.` };
    if (response.status !== 200)
      return { state: "uncertain", evidence: `Official page returned ${response.status}.` };
    const listings = parsePostings(response.text(), response.url);
    const listing = listings.find(
      (candidate) =>
        candidate.externalId === externalId ||
        candidate.officialUrl === officialUrl ||
        listings.length === 1,
    );
    return listing
      ? { state: "open", listing }
      : {
          state: "uncertain",
          evidence: "The page loaded but valid matching JobPosting data was absent.",
        };
  }
}
