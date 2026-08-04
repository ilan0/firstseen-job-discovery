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

const locationSchema = z.object({ name: z.string() });
const greenhouseJobSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    internal_job_id: z.union([z.number(), z.string()]).nullable().optional(),
    requisition_id: z.string().nullable().optional(),
    title: z.string(),
    location: locationSchema,
    absolute_url: z.string().url(),
    content: z.string().optional().default(""),
    first_published: z.string().datetime({ offset: true }).optional(),
    updated_at: z.string().datetime({ offset: true }).optional(),
    pay_input_ranges: z
      .array(
        z.object({
          min_cents: z.number().optional(),
          max_cents: z.number().optional(),
          currency_type: z.string().optional(),
          title: z.string().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();
const greenhouseListSchema = z.object({ jobs: z.array(greenhouseJobSchema) });

function salaryText(job: z.infer<typeof greenhouseJobSchema>): string | null {
  const range = job.pay_input_ranges?.[0];
  if (!range?.currency_type || range.min_cents === undefined || range.max_cents === undefined)
    return null;
  return `${range.currency_type} ${range.min_cents / 100}-${range.max_cents / 100}`;
}

function normalize(job: z.infer<typeof greenhouseJobSchema>): NormalizedListing {
  return {
    externalId: String(job.id),
    requisitionId: job.requisition_id ?? null,
    title: job.title.trim(),
    descriptionText: htmlToText(job.content),
    officialUrl: job.absolute_url,
    applyUrl: job.absolute_url,
    locations: [job.location.name],
    workplaceType: /remote/i.test(job.location.name) ? "Remote" : null,
    employmentType: null,
    postedAt: job.first_published ?? job.updated_at ?? null,
    postedAtConfidence: job.first_published ? "high" : job.updated_at ? "low" : "low",
    salaryText: salaryText(job),
    sourceConfidence: "high",
    rawMetadata: {
      internalJobId: job.internal_job_id ?? null,
      updatedAt: job.updated_at ?? null,
    },
  };
}

export class GreenhouseConnector implements JobConnector {
  readonly kind = "greenhouse" as const;
  readonly version = connectorVersions.greenhouse;

  constructor(private readonly get: SafeGet = safeGet) {}

  async discover(source: ConnectorSource, context: ConnectorContext = {}): Promise<DiscoveryPage> {
    const tenant = requiredTenant(source);
    const response = await this.get(
      `https://boards-api.greenhouse.io/v1/boards/${tenant}/jobs?content=true`,
      {
        allowedHosts: ["boards-api.greenhouse.io"],
        // Large employers can legitimately return several megabytes when the
        // official board API includes every description in one response.
        maximumBytes: 8_000_000,
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
        boardNotFound ? "GREENHOUSE_BOARD_NOT_FOUND" : "GREENHOUSE_HTTP_ERROR",
        "Greenhouse returned an unexpected response.",
        response.status === 429 || response.status >= 500,
        response.status,
      );
    }
    const parsed = greenhouseListSchema.safeParse(response.json<unknown>());
    if (!parsed.success) {
      throw new ConnectorError(
        "GREENHOUSE_SCHEMA_ERROR",
        "Greenhouse returned an unsupported response.",
        false,
      );
    }
    return {
      listings: parsed.data.jobs.map(normalize),
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
    if (!externalId || !/^\d+$/.test(externalId)) {
      return { state: "uncertain", evidence: "Greenhouse job ID is missing." };
    }
    const tenant = requiredTenant(source);
    const response = await this.get(
      `https://boards-api.greenhouse.io/v1/boards/${tenant}/jobs/${externalId}?pay_transparency=true`,
      {
        allowedHosts: ["boards-api.greenhouse.io"],
        ...(context.signal ? { signal: context.signal } : {}),
      },
    );
    if ([404, 410].includes(response.status))
      return { state: "closed", evidence: `Official API returned ${response.status}.` };
    if (response.status !== 200)
      return { state: "uncertain", evidence: `Official API returned ${response.status}.` };
    const parsed = greenhouseJobSchema.safeParse(response.json<unknown>());
    if (!parsed.success)
      return { state: "uncertain", evidence: "Official API response did not validate." };
    return { state: "open", listing: normalize(parsed.data) };
  }
}
