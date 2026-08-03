// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { ConnectorError } from "./errors";
import { assertSafeUrl, isPublicIp } from "./http";
import { withConnectorRetry } from "./retry";
import { runSourcesIsolated } from "./run";
import type { ConnectorSource, DiscoveryPage, JobConnector } from "./types";

const emptyPage: DiscoveryPage = {
  listings: [],
  nextCursor: null,
  etag: null,
  lastModified: null,
  notModified: false,
};

describe("connector network policy", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "2001:db8::1",
  ])("blocks non-public IP address %s", (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "allows public IP address %s",
    (address) => {
      expect(isPublicIp(address)).toBe(true);
    },
  );

  it.each([
    "file:///etc/passwd",
    "ftp://example.com/jobs",
    "https://user:password@example.com/jobs",
    "https://127.0.0.1/jobs",
  ])("rejects unsafe URL %s", async (url) => {
    await expect(assertSafeUrl(url)).rejects.toBeInstanceOf(ConnectorError);
  });

  it("enforces known connector host allowlists before network access", async () => {
    await expect(
      assertSafeUrl("https://example.com/jobs", { allowedHosts: ["boards.greenhouse.io"] }),
    ).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
  });
});

describe("connector retries", () => {
  it("retries retryable failures with exponential delays", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ConnectorError("TEMPORARY", "Temporary failure.", true))
      .mockRejectedValueOnce(new ConnectorError("TEMPORARY", "Temporary failure.", true))
      .mockResolvedValue("done");
    const wait = vi.fn<() => Promise<void>>().mockResolvedValue();

    await expect(
      withConnectorRetry(operation, { baseDelayMs: 100, random: () => 0.5, wait }),
    ).resolves.toBe("done");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 100);
    expect(wait).toHaveBeenNthCalledWith(2, 200);
  });

  it("does not retry permanent failures", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new ConnectorError("INVALID", "Invalid source.", false));

    await expect(withConnectorRetry(operation)).rejects.toMatchObject({ code: "INVALID" });
    expect(operation).toHaveBeenCalledOnce();
  });
});

describe("source-run isolation", () => {
  it("preserves successful sources when a neighboring source fails", async () => {
    const sources: ConnectorSource[] = ["a", "b", "c"].map((id) => ({
      id,
      kind: "greenhouse",
      companyName: id,
      baseUrl: "https://boards.greenhouse.io/example",
    }));
    const connector = (source: ConnectorSource): JobConnector => ({
      kind: "greenhouse",
      version: "test",
      discover: async () => {
        if (source.id === "b") throw new ConnectorError("BROKEN_SOURCE", "Source failed.", false);
        return emptyPage;
      },
      verify: async () => ({ state: "uncertain", evidence: "not tested" }),
    });

    const results = await runSourcesIsolated(sources, connector, 2);

    expect(results).toHaveLength(3);
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(results[1]).toMatchObject({ ok: false, errorCode: "BROKEN_SOURCE" });
  });
});
