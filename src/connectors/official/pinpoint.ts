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

const namedObjectSchema = z.object({ id: z.union([z.string(), z.number()]), name: z.string() });
const pinpointPostingSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string(),
    url: z.string().url(),
    description: z.string().optional().default(""),
    key_responsibilities: z.string().nullable().optional(),
    skills_knowledge_expertise: z.string().nullable().optional(),
    benefits: z.string().nullable().optional(),
    employment_type: z.string().nullable().optional(),
    employment_type_text: z.string().nullable().optional(),
    workplace_type: z.string().nullable().optional(),
    workplace_type_text: z.string().nullable().optional(),
    compensation: z.string().nullable().optional(),
    compensation_visible: z.boolean().optional(),
    deadline_at: z.string().nullable().optional(),
    location: namedObjectSchema
      .extend({
        city: z.string().nullable().optional(),
        province: z.string().nullable().optional(),
      })
      .passthrough(),
    job: z
      .object({
        id: z.union([z.string(), z.number()]),
        requisition_id: z.string().nullable().optional(),
        department: namedObjectSchema.nullable().optional(),
        division: namedObjectSchema.nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
const pinpointListSchema = z.object({ data: z.array(pinpointPostingSchema) });

function normalize(posting: z.infer<typeof pinpointPostingSchema>): NormalizedListing {
  const description = [
    posting.description,
    posting.key_responsibilities,
    posting.skills_knowledge_expertise,
    posting.benefits,
  ]
    .filter(Boolean)
    .join("\n");
  const location =
    posting.location.name.trim() ||
    [posting.location.city, posting.location.province].filter(Boolean).join(", ");
  return {
    externalId: String(posting.id),
    requisitionId: posting.job?.requisition_id ?? null,
    title: posting.title.trim(),
    descriptionText: htmlToText(description),
    officialUrl: posting.url,
    applyUrl: posting.url,
    locations: location ? [location] : [],
    workplaceType: posting.workplace_type_text ?? posting.workplace_type ?? null,
    employmentType: posting.employment_type_text ?? posting.employment_type ?? null,
    // Pinpoint's public postings feed does not expose a published timestamp.
    postedAt: null,
    postedAtConfidence: "low",
    salaryText:
      posting.compensation_visible === false ? null : (posting.compensation?.trim() ?? null),
    sourceConfidence: "high",
    rawMetadata: {
      jobId: posting.job ? String(posting.job.id) : null,
      department: posting.job?.department?.name ?? null,
      division: posting.job?.division?.name ?? null,
      deadlineAt: posting.deadline_at ?? null,
    },
  };
}

export class PinpointConnector implements JobConnector {
  readonly kind = "pinpoint" as const;
  readonly version = connectorVersions.pinpoint;

  constructor(private readonly get: SafeGet = safeGet) {}

  async discover(source: ConnectorSource, context: ConnectorContext = {}): Promise<DiscoveryPage> {
    const tenant = requiredTenant(source);
    const response = await this.get(`https://${tenant}.pinpointhq.com/postings.json`, {
      allowedHosts: ["pinpointhq.com"],
      maximumBytes: 8_000_000,
      allowedContentTypes: ["application/json"],
      headers: conditionalHeaders(source),
      ...(context.signal ? { signal: context.signal } : {}),
    });
    const headers = headerMetadata(response.headers);
    if (response.status === 304)
      return { listings: [], nextCursor: null, ...headers, notModified: true };
    if (response.status !== 200) {
      const boardNotFound = [404, 410].includes(response.status);
      throw new ConnectorError(
        boardNotFound ? "PINPOINT_BOARD_NOT_FOUND" : "PINPOINT_HTTP_ERROR",
        "Pinpoint returned an unexpected response.",
        response.status === 429 || response.status >= 500,
        response.status,
      );
    }
    const parsed = pinpointListSchema.safeParse(response.json<unknown>());
    if (!parsed.success)
      throw new ConnectorError(
        "PINPOINT_SCHEMA_ERROR",
        "Pinpoint returned an unsupported response.",
        false,
      );
    return {
      listings: parsed.data.data.map(normalize),
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
      : {
          state: "closed",
          evidence: "Posting was absent from a successful complete official Pinpoint feed.",
        };
  }
}
