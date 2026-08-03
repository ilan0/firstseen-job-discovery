import { AshbyConnector, GreenhouseConnector, LeverConnector } from "@/connectors/official";
import type { ConnectorSource, JobConnector } from "@/connectors/types";

const checks: Array<{ connector: JobConnector; source: ConnectorSource }> = [
  {
    connector: new GreenhouseConnector(),
    source: {
      id: "greenhouse-smoke",
      kind: "greenhouse",
      companyName: "Figma",
      baseUrl: "https://boards.greenhouse.io/figma",
      tenantId: "figma",
    },
  },
  {
    connector: new LeverConnector(),
    source: {
      id: "lever-smoke",
      kind: "lever",
      companyName: "Palantir",
      baseUrl: "https://jobs.lever.co/palantir",
      tenantId: "palantir",
    },
  },
  {
    connector: new AshbyConnector(),
    source: {
      id: "ashby-smoke",
      kind: "ashby",
      companyName: "Linear",
      baseUrl: "https://jobs.ashbyhq.com/linear",
      tenantId: "linear",
    },
  },
];

const results = [];
for (const check of checks) {
  try {
    const page = await check.connector.discover(check.source);
    const sample = page.listings[0];
    const verification = sample
      ? await check.connector.verify(check.source, sample.officialUrl, sample.externalId)
      : null;
    results.push({
      kind: check.connector.kind,
      ok: true,
      listingCount: page.listings.length,
      paginationPresent: Boolean(page.nextCursor),
      sampleVerified: verification?.state ?? "no_sample",
    });
  } catch (error) {
    results.push({
      kind: check.connector.kind,
      ok: false,
      code: error instanceof Error ? error.name : "UNKNOWN",
    });
  }
}
console.log(JSON.stringify(results));
if (results.some((result) => !result.ok)) process.exitCode = 1;
