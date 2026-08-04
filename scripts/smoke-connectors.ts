import {
  AshbyConnector,
  GreenhouseConnector,
  LeverConnector,
  PinpointConnector,
  RecruiteeConnector,
} from "@/connectors/official";
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
  ...["amperecloud", "xneelo"].map((tenantId) => ({
    connector: new RecruiteeConnector(),
    source: {
      id: `recruitee-${tenantId}-smoke`,
      kind: "recruitee" as const,
      companyName: tenantId,
      baseUrl: `https://${tenantId}.recruitee.com`,
      tenantId,
    },
  })),
  ...["workwithus", "wealthwizards"].map((tenantId) => ({
    connector: new PinpointConnector(),
    source: {
      id: `pinpoint-${tenantId}-smoke`,
      kind: "pinpoint" as const,
      companyName: tenantId,
      baseUrl: `https://${tenantId}.pinpointhq.com`,
      tenantId,
    },
  })),
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
      tenant: check.source.tenantId,
      ok: true,
      listingCount: page.listings.length,
      paginationPresent: Boolean(page.nextCursor),
      sampleVerified: verification?.state ?? "no_sample",
    });
  } catch (error) {
    const safe = error as { code?: string; name?: string; status?: number };
    results.push({
      kind: check.connector.kind,
      tenant: check.source.tenantId,
      ok: false,
      code: safe.code ?? safe.name ?? "UNKNOWN",
      status: safe.status ?? null,
    });
  }
}
console.log(JSON.stringify(results));
if (results.some((result) => !result.ok)) process.exitCode = 1;
