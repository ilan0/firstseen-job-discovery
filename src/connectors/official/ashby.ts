import { z } from "zod";
import { ConnectorError } from "../errors";
import { safeGet, type SafeGet } from "../http";
import { conditionalHeaders, headerMetadata, idFromUrl, requiredTenant } from "../normalize";
import type {
  ConnectorContext,
  ConnectorSource,
  DiscoveryPage,
  JobConnector,
  NormalizedListing,
  VerificationResult,
} from "../types";
import { connectorVersions } from "../versions";

const ashbyLocationSchema = z.object({ location: z.string() }).passthrough();
const ashbyJobSchema = z
  .object({
    title: z.string(),
    location: z.string().optional().default(""),
    secondaryLocations: z.array(ashbyLocationSchema).optional(),
    department: z.string().optional(),
    team: z.string().optional(),
    isListed: z.boolean().optional().default(true),
    // Older postings on otherwise valid public boards can return these as null.
    isRemote: z.boolean().nullish(),
    workplaceType: z.string().nullish(),
    descriptionPlain: z.string(),
    publishedAt: z.string().datetime({ offset: true }).optional(),
    employmentType: z.string().optional(),
    jobUrl: z.string().url(),
    applyUrl: z.string().url(),
    compensation: z
      .object({
        compensationTierSummary: z.string().nullable().optional(),
        scrapeableCompensationSalarySummary: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
const ashbyListSchema = z.object({ apiVersion: z.string(), jobs: z.array(ashbyJobSchema) });

function normalize(job: z.infer<typeof ashbyJobSchema>): NormalizedListing {
  return {
    externalId: idFromUrl(job.jobUrl),
    requisitionId: null,
    title: job.title.trim(),
    descriptionText: job.descriptionPlain.trim(),
    officialUrl: job.jobUrl,
    applyUrl: job.applyUrl,
    locations: [
      job.location,
      ...(job.secondaryLocations?.map((item) => item.location) ?? []),
    ].filter(Boolean),
    workplaceType: job.workplaceType ?? (job.isRemote ? "Remote" : null),
    employmentType: job.employmentType ?? null,
    postedAt: job.publishedAt ?? null,
    postedAtConfidence: job.publishedAt ? "high" : "low",
    salaryText:
      job.compensation?.scrapeableCompensationSalarySummary ??
      job.compensation?.compensationTierSummary ??
      null,
    sourceConfidence: "high",
    rawMetadata: {
      department: job.department ?? null,
      team: job.team ?? null,
      isListed: job.isListed,
    },
  };
}

export class AshbyConnector implements JobConnector {
  readonly kind = "ashby" as const;
  readonly version = connectorVersions.ashby;

  constructor(private readonly get: SafeGet = safeGet) {}

  async discover(source: ConnectorSource, context: ConnectorContext = {}): Promise<DiscoveryPage> {
    const tenant = requiredTenant(source);
    const response = await this.get(
      `https://api.ashbyhq.com/posting-api/job-board/${tenant}?includeCompensation=true`,
      {
        allowedHosts: ["api.ashbyhq.com"],
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
        boardNotFound ? "ASHBY_BOARD_NOT_FOUND" : "ASHBY_HTTP_ERROR",
        "Ashby returned an unexpected response.",
        response.status === 429 || response.status >= 500,
        response.status,
      );
    }
    const parsed = ashbyListSchema.safeParse(response.json<unknown>());
    if (!parsed.success)
      throw new ConnectorError(
        "ASHBY_SCHEMA_ERROR",
        "Ashby returned an unsupported response.",
        false,
      );
    return {
      listings: parsed.data.jobs.filter((job) => job.isListed).map(normalize),
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
      (job) => job.externalId === externalId || job.officialUrl === officialUrl,
    );
    return listing
      ? { state: "open", listing }
      : {
          state: "closed",
          evidence: "Posting was absent from a successful official Ashby board response.",
        };
  }
}
