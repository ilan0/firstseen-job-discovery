import { describe, expect, it } from "vitest";
import type { DiscoveryPage, JobConnector } from "@/connectors/types";
import { discoverAllPages } from "./discover-pages";

const source = {
  id: "s",
  kind: "lever" as const,
  companyName: "Example",
  baseUrl: "https://jobs.lever.co/example",
  tenantId: "example",
};
function page(ids: string[], nextCursor: string | null): DiscoveryPage {
  return {
    listings: ids.map((id) => ({
      externalId: id,
      requisitionId: null,
      title: id,
      descriptionText: "",
      officialUrl: `https://jobs.lever.co/example/${id}`,
      applyUrl: `https://jobs.lever.co/example/${id}`,
      locations: [],
      workplaceType: null,
      employmentType: null,
      postedAt: null,
      postedAtConfidence: "low",
      salaryText: null,
      sourceConfidence: "high",
      rawMetadata: {},
    })),
    nextCursor,
    etag: null,
    lastModified: null,
    notModified: false,
  };
}

describe("connector pagination", () => {
  it("collects every page and supplies the cursor", async () => {
    const cursors: Array<string | null | undefined> = [];
    const connector = {
      kind: "lever",
      version: "test",
      discover: async (_source, context) => {
        cursors.push(context?.cursor);
        return cursors.length === 1 ? page(["a"], "100") : page(["b"], null);
      },
      verify: async () => ({ state: "uncertain" as const, evidence: "test" }),
    } satisfies JobConnector;
    const result = await discoverAllPages(connector, source);
    expect(result.listings.map((item) => item.externalId)).toEqual(["a", "b"]);
    expect(cursors).toEqual([undefined, "100"]);
  });
  it("preserves a conditional not-modified response", async () => {
    const connector = {
      kind: "lever",
      version: "test",
      discover: async () => ({
        listings: [],
        nextCursor: null,
        etag: "x",
        lastModified: null,
        notModified: true,
      }),
      verify: async () => ({ state: "uncertain" as const, evidence: "test" }),
    } satisfies JobConnector;
    expect((await discoverAllPages(connector, source)).notModified).toBe(true);
  });
});
