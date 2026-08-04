import { z } from "zod";
import { ConnectorError } from "../errors";
import { safeGet, type SafeGet } from "../http";
import { conditionalHeaders, headerMetadata, htmlToText, requiredTenant } from "../normalize";
import type {
  ConnectorContext,
  ConnectorSource,
  DiscoveryPage,
  JobConnector,
  NormalizedListing,
  VerificationResult,
} from "../types";
import { connectorVersions } from "../versions";

const recruiteeLocationSchema = z
  .object({
    name: z.string().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
  })
  .passthrough();

const recruiteeOfferSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    slug: z.string(),
    status: z.string().optional(),
    title: z.string(),
    description: z.string().optional().default(""),
    requirements: z.string().optional().default(""),
    location: z.string().nullable().optional(),
    locations: z.array(recruiteeLocationSchema).optional(),
    employment_type_code: z.string().nullable().optional(),
    published_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    careers_url: z.string().url(),
    careers_apply_url: z.string().url().optional(),
    remote: z.boolean().optional(),
    hybrid: z.boolean().optional(),
    on_site: z.boolean().optional(),
    salary: z.unknown().optional(),
    department: z.string().nullable().optional(),
    close_at: z.string().nullable().optional(),
  })
  .passthrough();

const recruiteeListSchema = z.object({ offers: z.array(recruiteeOfferSchema) });
const recruiteeDetailSchema = z.object({ offer: recruiteeOfferSchema });

function parsedDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function locationName(location: z.infer<typeof recruiteeLocationSchema>): string | null {
  return (
    location.name?.trim() ||
    [location.city, location.state, location.country].filter(Boolean).join(", ") ||
    null
  );
}

function normalize(offer: z.infer<typeof recruiteeOfferSchema>): NormalizedListing {
  const publishedAt = parsedDate(offer.published_at);
  const locations = [
    ...(offer.locations?.map(locationName) ?? []),
    offer.location?.trim() || null,
  ].filter((value): value is string => Boolean(value));
  const workplaceType = offer.remote
    ? "Remote"
    : offer.hybrid
      ? "Hybrid"
      : offer.on_site
        ? "On-site"
        : null;
  return {
    externalId: String(offer.id),
    requisitionId: null,
    title: offer.title.trim(),
    descriptionText: htmlToText([offer.description, offer.requirements].join("\n")),
    officialUrl: offer.careers_url,
    applyUrl: offer.careers_apply_url ?? offer.careers_url,
    locations: [...new Set(locations)],
    workplaceType,
    employmentType: offer.employment_type_code ?? null,
    postedAt: publishedAt,
    postedAtConfidence: publishedAt ? "high" : "low",
    salaryText:
      typeof offer.salary === "string" && offer.salary.trim() ? offer.salary.trim() : null,
    sourceConfidence: "high",
    rawMetadata: {
      slug: offer.slug,
      department: offer.department ?? null,
      updatedAt: parsedDate(offer.updated_at),
      closeAt: parsedDate(offer.close_at),
    },
  };
}

export class RecruiteeConnector implements JobConnector {
  readonly kind = "recruitee" as const;
  readonly version = connectorVersions.recruitee;

  constructor(private readonly get: SafeGet = safeGet) {}

  async discover(source: ConnectorSource, context: ConnectorContext = {}): Promise<DiscoveryPage> {
    const tenant = requiredTenant(source);
    const response = await this.get(`https://${tenant}.recruitee.com/api/offers/`, {
      allowedHosts: ["recruitee.com"],
      maximumBytes: 8_000_000,
      allowedContentTypes: ["application/json", "text/plain"],
      headers: conditionalHeaders(source),
      ...(context.signal ? { signal: context.signal } : {}),
    });
    const headers = headerMetadata(response.headers);
    if (response.status === 304)
      return { listings: [], nextCursor: null, ...headers, notModified: true };
    if (response.status !== 200) {
      const boardNotFound = [404, 410].includes(response.status);
      throw new ConnectorError(
        boardNotFound ? "RECRUITEE_BOARD_NOT_FOUND" : "RECRUITEE_HTTP_ERROR",
        "Recruitee returned an unexpected response.",
        response.status === 429 || response.status >= 500,
        response.status,
      );
    }
    const parsed = recruiteeListSchema.safeParse(response.json<unknown>());
    if (!parsed.success)
      throw new ConnectorError(
        "RECRUITEE_SCHEMA_ERROR",
        "Recruitee returned an unsupported response.",
        false,
      );
    return {
      listings: parsed.data.offers
        .filter((offer) => !offer.status || offer.status === "published")
        .map(normalize),
      nextCursor: null,
      ...headers,
      notModified: false,
    };
  }

  async verify(
    source: ConnectorSource,
    _officialUrl: string,
    externalId?: string | null,
    context: ConnectorContext = {},
  ): Promise<VerificationResult> {
    if (!externalId || !/^[a-zA-Z0-9_-]+$/.test(externalId))
      return { state: "uncertain", evidence: "Recruitee offer ID is missing." };
    const tenant = requiredTenant(source);
    const response = await this.get(`https://${tenant}.recruitee.com/api/offers/${externalId}`, {
      allowedHosts: ["recruitee.com"],
      allowedContentTypes: ["application/json", "text/plain", "text/html"],
      ...(context.signal ? { signal: context.signal } : {}),
    });
    if ([404, 410].includes(response.status))
      return { state: "closed", evidence: `Official API returned ${response.status}.` };
    if (response.status !== 200)
      return { state: "uncertain", evidence: `Official API returned ${response.status}.` };
    const parsed = recruiteeDetailSchema.safeParse(response.json<unknown>());
    if (!parsed.success || (parsed.data.offer.status && parsed.data.offer.status !== "published"))
      return {
        state: "uncertain",
        evidence: "Official API response did not validate as published.",
      };
    return { state: "open", listing: normalize(parsed.data.offer) };
  }
}
