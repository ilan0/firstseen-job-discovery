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

const leverJobSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    categories: z
      .object({
        location: z.string().optional(),
        allLocations: z.array(z.string()).optional(),
        commitment: z.string().optional(),
        team: z.string().optional(),
        department: z.string().optional(),
      })
      .passthrough(),
    descriptionPlain: z.string().optional(),
    description: z.string().optional(),
    additionalPlain: z.string().optional(),
    hostedUrl: z.string().url(),
    applyUrl: z.string().url(),
    workplaceType: z.string().optional(),
    salaryDescriptionPlain: z.string().optional(),
    salaryRange: z
      .object({
        currency: z.string(),
        interval: z.string(),
        min: z.number(),
        max: z.number(),
      })
      .optional(),
    createdAt: z.number().optional(),
  })
  .passthrough();
const leverListSchema = z.array(leverJobSchema);

function hosts(source: ConnectorSource) {
  const eu = source.publicConfig?.region === "eu";
  return {
    api: eu ? "api.eu.lever.co" : "api.lever.co",
    allowed: ["api.lever.co", "api.eu.lever.co"],
  };
}

function normalize(job: z.infer<typeof leverJobSchema>): NormalizedListing {
  const locations = job.categories.allLocations?.length
    ? job.categories.allLocations
    : job.categories.location
      ? [job.categories.location]
      : [];
  const salary = job.salaryDescriptionPlain?.trim()
    ? job.salaryDescriptionPlain.trim()
    : job.salaryRange
      ? `${job.salaryRange.currency} ${job.salaryRange.min}-${job.salaryRange.max} ${job.salaryRange.interval}`
      : null;
  const description = job.descriptionPlain?.trim()
    ? job.descriptionPlain
    : htmlToText(job.description ?? "");

  return {
    externalId: job.id,
    requisitionId: null,
    title: job.text.trim(),
    descriptionText: [description, job.additionalPlain].filter(Boolean).join("\n\n").trim(),
    officialUrl: job.hostedUrl,
    applyUrl: job.applyUrl,
    locations,
    workplaceType: job.workplaceType ?? null,
    employmentType: job.categories.commitment ?? null,
    postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    postedAtConfidence: job.createdAt ? "medium" : "low",
    salaryText: salary,
    sourceConfidence: "high",
    rawMetadata: {
      team: job.categories.team ?? null,
      department: job.categories.department ?? null,
    },
  };
}

export class LeverConnector implements JobConnector {
  readonly kind = "lever" as const;
  readonly version = connectorVersions.lever;

  constructor(private readonly get: SafeGet = safeGet) {}

  async discover(source: ConnectorSource, context: ConnectorContext = {}): Promise<DiscoveryPage> {
    const tenant = requiredTenant(source);
    const { api, allowed } = hosts(source);
    const skip = Math.max(0, Number(context.cursor ?? 0) || 0);
    const limit = 100;
    const response = await this.get(
      `https://${api}/v0/postings/${tenant}?mode=json&skip=${skip}&limit=${limit}`,
      {
        allowedHosts: allowed,
        maximumBytes: 5_000_000,
        headers: conditionalHeaders(source),
        ...(context.signal ? { signal: context.signal } : {}),
      },
    );
    const headers = headerMetadata(response.headers);
    if (response.status === 304)
      return { listings: [], nextCursor: null, ...headers, notModified: true };
    if (response.status !== 200) {
      const boardNotFound = [404, 410].includes(response.status);
      throw new ConnectorError(
        boardNotFound ? "LEVER_BOARD_NOT_FOUND" : "LEVER_HTTP_ERROR",
        "Lever returned an unexpected response.",
        response.status === 429 || response.status >= 500,
        response.status,
      );
    }
    const parsed = leverListSchema.safeParse(response.json<unknown>());
    if (!parsed.success)
      throw new ConnectorError(
        "LEVER_SCHEMA_ERROR",
        "Lever returned an unsupported response.",
        false,
      );
    return {
      listings: parsed.data.map(normalize),
      nextCursor: parsed.data.length === limit ? String(skip + limit) : null,
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
    if (!externalId || !/^[a-zA-Z0-9-]+$/.test(externalId)) {
      return { state: "uncertain", evidence: "Lever posting ID is missing." };
    }
    const tenant = requiredTenant(source);
    const { api, allowed } = hosts(source);
    const response = await this.get(
      `https://${api}/v0/postings/${tenant}/${externalId}?mode=json`,
      {
        allowedHosts: allowed,
        ...(context.signal ? { signal: context.signal } : {}),
      },
    );
    if ([404, 410].includes(response.status))
      return { state: "closed", evidence: `Official API returned ${response.status}.` };
    if (response.status !== 200)
      return { state: "uncertain", evidence: `Official API returned ${response.status}.` };
    const parsed = leverJobSchema.safeParse(response.json<unknown>());
    if (!parsed.success)
      return { state: "uncertain", evidence: "Official API response did not validate." };
    return { state: "open", listing: normalize(parsed.data) };
  }
}
