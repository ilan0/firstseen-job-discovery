import { createHash } from "node:crypto";
import { z } from "zod";
import { ConnectorError } from "@/connectors/errors";
import { safeGet, type SafeGet } from "@/connectors/http";
import { braveQuery } from "../queries";
import type { DiscoveryCandidate, DiscoveryQuery, DiscoverySensor } from "../types";

const braveSchema = z.object({
  web: z
    .object({
      results: z.array(
        z
          .object({
            title: z.string(),
            url: z.string().url(),
            description: z.string().optional(),
            page_age: z.string().optional(),
            profile: z.object({ long_name: z.string().optional() }).optional(),
          })
          .passthrough(),
      ),
    })
    .optional(),
});

export class BraveSensor implements DiscoverySensor {
  readonly kind = "brave" as const;

  constructor(
    private readonly apiKey: string,
    private readonly get: SafeGet = safeGet,
  ) {}

  async search(query: DiscoveryQuery, signal?: AbortSignal): Promise<DiscoveryCandidate[]> {
    const parameters = new URLSearchParams({
      q: braveQuery(query),
      count: "20",
      freshness: "pw",
      search_lang: "en",
      country: "us",
      safesearch: "moderate",
    });
    const response = await this.get(
      `https://api.search.brave.com/res/v1/web/search?${parameters}`,
      {
        allowedHosts: ["api.search.brave.com"],
        headers: { "x-subscription-token": this.apiKey, accept: "application/json" },
        ...(signal ? { signal } : {}),
      },
    );
    if (response.status !== 200) {
      throw new ConnectorError(
        "BRAVE_HTTP_ERROR",
        "Brave Search returned an unexpected response.",
        false,
        response.status,
      );
    }
    const parsed = braveSchema.safeParse(response.json<unknown>());
    if (!parsed.success)
      throw new ConnectorError(
        "BRAVE_SCHEMA_ERROR",
        "Brave Search returned an unsupported response.",
        false,
      );
    const now = new Date().toISOString();
    return (parsed.data.web?.results ?? []).map((result) => ({
      sensor: "brave",
      sensorId: createHash("sha256").update(result.url).digest("hex"),
      discoveredUrl: result.url,
      titleHint: result.title,
      companyHint: result.profile?.long_name ?? null,
      locationHint: query.remote ? "Remote - United States" : query.locationQuery,
      descriptionHint: result.description ?? null,
      discoveredAt: now,
      sensorPostedAt: result.page_age ?? null,
      sensorMetadata: { remoteQuery: query.remote },
    }));
  }
}
