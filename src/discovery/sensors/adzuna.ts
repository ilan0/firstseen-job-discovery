import { z } from "zod";
import { ConnectorError } from "@/connectors/errors";
import { safeGet, type SafeGet } from "@/connectors/http";
import type { DiscoveryCandidate, DiscoveryQuery, DiscoverySensor } from "../types";

const adzunaSchema = z.object({
  results: z.array(
    z
      .object({
        id: z.union([z.string(), z.number()]),
        title: z.string(),
        description: z.string().optional(),
        created: z.string().optional(),
        redirect_url: z.string().url(),
        company: z.object({ display_name: z.string().optional() }).optional(),
        location: z.object({ display_name: z.string().optional() }).optional(),
        contract_time: z.string().optional(),
      })
      .passthrough(),
  ),
});

export class AdzunaSensor implements DiscoverySensor {
  readonly kind = "adzuna" as const;

  constructor(
    private readonly appId: string,
    private readonly appKey: string,
    private readonly get: SafeGet = safeGet,
  ) {}

  async search(query: DiscoveryQuery, signal?: AbortSignal): Promise<DiscoveryCandidate[]> {
    const parameters = new URLSearchParams({
      app_id: this.appId,
      app_key: this.appKey,
      results_per_page: "30",
      what: query.roleQuery.replaceAll('"', ""),
      where: query.remote ? "United States" : query.locationQuery.split(" OR ")[0]!,
      max_days_old: "7",
      sort_by: "date",
      full_time: "1",
      "content-type": "application/json",
    });
    const response = await this.get(
      `https://api.adzuna.com/v1/api/jobs/us/search/1?${parameters}`,
      {
        allowedHosts: ["api.adzuna.com"],
        ...(signal ? { signal } : {}),
      },
    );
    if (response.status !== 200) {
      throw new ConnectorError(
        "ADZUNA_HTTP_ERROR",
        "Adzuna returned an unexpected response.",
        false,
        response.status,
      );
    }
    const parsed = adzunaSchema.safeParse(response.json<unknown>());
    if (!parsed.success)
      throw new ConnectorError(
        "ADZUNA_SCHEMA_ERROR",
        "Adzuna returned an unsupported response.",
        false,
      );
    const now = new Date().toISOString();
    return parsed.data.results.map((result) => ({
      sensor: "adzuna",
      sensorId: String(result.id),
      discoveredUrl: result.redirect_url,
      titleHint: result.title,
      companyHint: result.company?.display_name ?? null,
      locationHint: result.location?.display_name ?? null,
      descriptionHint: result.description ?? null,
      discoveredAt: now,
      sensorPostedAt: result.created ?? null,
      sensorMetadata: { contractTime: result.contract_time ?? null, remoteQuery: query.remote },
    }));
  }
}
