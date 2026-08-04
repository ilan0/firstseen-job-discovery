// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedListing } from "@/connectors/types";

const mocks = vi.hoisted(() => {
  const state = {
    selectResponses: [] as unknown[][],
    returningResponses: [] as unknown[][],
    discoverAllPages: vi.fn(),
    ingestGlobalListing: vi.fn(),
    extractSharedRequirements: vi.fn(),
    ingestListing: vi.fn(),
    analyzeAndRankListing: vi.fn(),
    mutationCount: 0,
  };
  function selectable(terminal: () => unknown[]) {
    const value = {
      from: () => value,
      innerJoin: () => value,
      where: () => value,
      orderBy: () => value,
      limit: () => Promise.resolve(terminal()),
      then: (resolve: (result: unknown[]) => unknown) => Promise.resolve(terminal()).then(resolve),
    };
    return value;
  }
  function mutable() {
    const value = {
      set: () => value,
      values: () => value,
      where: () => {
        state.mutationCount += 1;
        return Promise.resolve([]);
      },
      onConflictDoNothing: () => value,
      onConflictDoUpdate: () => value,
      returning: () => Promise.resolve(state.returningResponses.shift() ?? []),
      then: (resolve: (result: unknown[]) => unknown) => {
        state.mutationCount += 1;
        return Promise.resolve([]).then(resolve);
      },
    };
    return value;
  }
  const db = {
    select: () => selectable(() => state.selectResponses.shift() ?? []),
    update: () => mutable(),
    insert: () => mutable(),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db),
  };
  return Object.assign(state, { db });
});

vi.mock("server-only", () => ({}));

vi.mock("@/db/client", () => ({ db: mocks.db }));
vi.mock("@/connectors/registry", () => ({ connectorFor: () => ({ kind: "greenhouse" }) }));
vi.mock("@/lib/scans/discover-pages", () => ({
  discoverAllPages: mocks.discoverAllPages,
}));
vi.mock("./global-ingest", async (importOriginal) => {
  const original = await importOriginal<typeof import("./global-ingest")>();
  return { ...original, ingestGlobalListing: mocks.ingestGlobalListing };
});
vi.mock("./requirement-extraction", async (importOriginal) => {
  const original = await importOriginal<typeof import("./requirement-extraction")>();
  return { ...original, extractSharedRequirements: mocks.extractSharedRequirements };
});
vi.mock("@/lib/jobs/ingest", () => ({ ingestListing: mocks.ingestListing }));
vi.mock("@/lib/jobs/analyze-and-rank", () => ({
  analyzeAndRankListing: mocks.analyzeAndRankListing,
}));

import {
  personalizeGlobalListing,
  scanGlobalSource,
  type StoredGlobalSource,
} from "./global-source";

const source: StoredGlobalSource = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  organizationName: "Acme",
  organizationDomain: "acme.example",
  kind: "greenhouse",
  tenantId: "acme",
  baseUrl: "https://boards.greenhouse.io/acme",
  publicConfig: {},
  etag: null,
  lastModified: null,
};

const listing: NormalizedListing = {
  externalId: "job-1",
  requisitionId: "job-1",
  title: "Software Engineer I",
  descriptionText: "Full-time role with one year of experience.",
  officialUrl: "https://boards.greenhouse.io/acme/jobs/job-1",
  applyUrl: "https://boards.greenhouse.io/acme/jobs/job-1",
  locations: ["New York, NY"],
  workplaceType: "On-site",
  employmentType: "Full-time",
  postedAt: "2026-08-04T12:00:00.000Z",
  postedAtConfidence: "high",
  salaryText: null,
  sourceConfidence: "high",
  rawMetadata: {},
};

describe("global source scan orchestration", () => {
  beforeEach(() => {
    mocks.selectResponses.length = 0;
    mocks.returningResponses.length = 0;
    mocks.mutationCount = 0;
    vi.clearAllMocks();
  });

  it("short-circuits a conditional not-modified response", async () => {
    mocks.discoverAllPages.mockResolvedValue({
      listings: [],
      nextCursor: null,
      etag: '"same"',
      lastModified: null,
      notModified: true,
    });

    await expect(scanGlobalSource(source, new Date("2026-08-04T13:00:00Z"))).resolves.toEqual({
      notModified: true,
      discovered: 0,
      changed: 0,
      personalized: 0,
      closed: 0,
      tasks: [],
    });
    expect(mocks.ingestGlobalListing).not.toHaveBeenCalled();
  });

  it("fetches once, stages durable extraction work, and advances closure without inline AI", async () => {
    mocks.discoverAllPages.mockResolvedValue({
      listings: [listing],
      nextCursor: null,
      etag: '"new"',
      lastModified: "Tue, 04 Aug 2026 12:00:00 GMT",
      notModified: false,
    });
    mocks.ingestGlobalListing.mockResolvedValue({
      jobId: "00000000-0000-4000-8000-000000000010",
      snapshotId: "00000000-0000-4000-8000-000000000011",
      changed: true,
      created: true,
    });
    mocks.selectResponses.push(
      [],
      [
        {
          id: "00000000-0000-4000-8000-000000000030",
          externalJobId: "missing-job",
          normalizedOfficialUrl: "https://boards.greenhouse.io/acme/jobs/missing-job",
          lifecycleStatus: "open",
          consecutiveSuccessfulMisses: 0,
          possiblyClosedAt: null,
          closedAt: null,
          reopenedAt: null,
        },
      ],
    );
    await expect(
      scanGlobalSource(
        source,
        new Date("2026-08-04T13:00:00Z"),
        "00000000-0000-4000-8000-000000000060",
      ),
    ).resolves.toMatchObject({
      notModified: false,
      discovered: 1,
      changed: 1,
      personalized: 0,
      closed: 1,
      tasks: [
        {
          jobId: "00000000-0000-4000-8000-000000000010",
          snapshotId: "00000000-0000-4000-8000-000000000011",
        },
      ],
    });
    expect(mocks.extractSharedRequirements).not.toHaveBeenCalled();
    expect(mocks.analyzeAndRankListing).not.toHaveBeenCalled();
  });

  it("does not spend AI budget inside the authoritative supply scan", async () => {
    mocks.discoverAllPages.mockResolvedValue({
      listings: [listing],
      nextCursor: null,
      etag: null,
      lastModified: null,
      notModified: false,
    });
    mocks.ingestGlobalListing.mockResolvedValue({
      jobId: "00000000-0000-4000-8000-000000000010",
      snapshotId: "00000000-0000-4000-8000-000000000011",
      changed: false,
      created: false,
    });
    mocks.selectResponses.push([], []);

    await expect(scanGlobalSource(source)).resolves.toMatchObject({
      discovered: 1,
      changed: 0,
      personalized: 0,
    });
    expect(mocks.extractSharedRequirements).not.toHaveBeenCalled();
  });

  it("uses the latest persisted description when a reopening has no new snapshot", async () => {
    const overlay = {
      id: "00000000-0000-4000-8000-000000000020",
      userId: "00000000-0000-4000-8000-000000000021",
      companyId: "00000000-0000-4000-8000-000000000022",
      companyName: "Acme",
      companyDomain: "acme.example",
      kind: "greenhouse" as const,
      baseUrl: source.baseUrl,
      tenantId: "acme",
      etag: null,
      lastModified: null,
    };
    mocks.selectResponses.push(
      [{ id: "referral-1" }],
      [{ status: "active" }],
      [{ id: "00000000-0000-4000-8000-000000000041" }],
    );
    mocks.ingestListing.mockResolvedValue({
      jobId: "00000000-0000-4000-8000-000000000040",
      snapshotId: null,
      changed: false,
      reopened: false,
      postedAt: new Date("2026-08-04T12:00:00Z"),
      postedAtConfidence: "high",
      firstSeenAt: new Date("2026-07-01T12:30:00Z"),
      reopenedAt: null,
    });
    mocks.analyzeAndRankListing.mockResolvedValue({
      state: "analyzed",
      decision: { outcome: "eligible", reasons: [], uncertainFields: [] },
      recommendation: {
        band: "strong",
        urgency: 92,
        headline: "Strong fresh match",
        routingReasons: [],
        version: "ranking-v1",
        dimensions: [],
      },
    });
    mocks.returningResponses.push([{ id: "00000000-0000-4000-8000-000000000050" }]);

    await expect(
      personalizeGlobalListing(
        overlay,
        listing,
        {
          jobId: "00000000-0000-4000-8000-000000000010",
          snapshotId: "00000000-0000-4000-8000-000000000011",
          changed: false,
          reopened: true,
          postedAt: new Date("2026-08-04T12:00:00Z"),
          postedAtConfidence: "high",
          firstSeenAt: new Date("2026-07-01T12:30:00Z"),
          reopenedAt: new Date("2026-08-04T12:45:00Z"),
        },
        {
          id: "00000000-0000-4000-8000-000000000012",
          status: "succeeded",
          model: "gpt-5.6-luna",
          analysis: {} as never,
          errorCode: null,
          unresolvedFields: [],
        },
        new Date("2026-08-04T13:00:00Z"),
      ),
    ).resolves.toMatchObject({
      state: "analyzed",
      exceptional: {
        band: "strong",
        urgency: 92,
        hasReferral: true,
        snapshotId: "00000000-0000-4000-8000-000000000041",
        occurrenceId: "reopened:2026-08-04T12:45:00.000Z",
      },
    });
    expect(mocks.analyzeAndRankListing).toHaveBeenCalledOnce();
  });
});
