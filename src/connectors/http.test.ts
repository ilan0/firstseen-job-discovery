// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSafeUrl, isPublicIp, safeGet } from "./http";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("safe connector HTTP", () => {
  it.each([
    ["::ffff:127.0.0.1", false],
    ["::ffff:8.8.8.8", true],
    ["0.1.2.3", false],
    ["100.127.0.1", false],
    ["172.31.255.255", false],
    ["198.18.0.1", false],
    ["224.0.0.1", false],
    ["not-an-ip", false],
    ["2001:4860:4860::8888", true],
  ])("classifies %s as public=%s", (address, expected) => {
    expect(isPublicIp(address)).toBe(expected);
  });

  it.each([
    "not a URL",
    "https://example.com:8443/jobs",
    "https://localhost/jobs",
    "https://careers.example.local/jobs",
  ])("rejects invalid or private URL %s", async (url) => {
    await expect(assertSafeUrl(url)).rejects.toMatchObject({
      code: expect.stringMatching(/INVALID_URL|UNSAFE_URL|PRIVATE_HOST/),
    });
  });

  it("reads bounded responses and exposes safe text and JSON helpers", async () => {
    const fetcher = vi.fn(async (_input: URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("user-agent")).toContain("FirstSeen");
      expect(new Headers(init?.headers).get("x-test")).toBe("yes");
      return new Response('{"jobs":2}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);

    const response = await safeGet("https://8.8.8.8/jobs", {
      headers: { "x-test": "yes" },
    });

    expect(response.status).toBe(200);
    expect(response.url).toBe("https://8.8.8.8/jobs");
    expect(response.text()).toBe('{"jobs":2}');
    expect(response.json<{ jobs: number }>()).toEqual({ jobs: 2 });
    expect(response.body).toBeInstanceOf(Uint8Array);
  });

  it("follows a relative redirect and validates the destination again", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "/official" } }),
      )
      .mockResolvedValueOnce(new Response("done", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    const response = await safeGet("https://8.8.8.8/start");

    expect(response.url).toBe("https://8.8.8.8/official");
    expect(response.text()).toBe("done");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed and excessive redirects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 302 })),
    );
    await expect(safeGet("https://8.8.8.8/start")).rejects.toMatchObject({
      code: "INVALID_REDIRECT",
      retryable: false,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 302, headers: { location: "/another" } })),
    );
    await expect(safeGet("https://8.8.8.8/start", { maximumRedirects: 1 })).rejects.toMatchObject({
      code: "TOO_MANY_REDIRECTS",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 302, headers: { location: "/start" } })),
    );
    await expect(safeGet("https://8.8.8.8/start")).rejects.toMatchObject({
      code: "REDIRECT_LOOP",
    });
  });

  it("rejects missing and unsupported final content types", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2]), {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          }),
      ),
    );
    await expect(safeGet("https://8.8.8.8/jobs")).rejects.toMatchObject({
      code: "UNSUPPORTED_CONTENT_TYPE",
      retryable: false,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    await expect(safeGet("https://8.8.8.8/jobs")).rejects.toMatchObject({
      code: "UNSUPPORTED_CONTENT_TYPE",
    });
  });

  it.each([
    [429, "SOURCE_RATE_LIMITED"],
    [500, "SOURCE_UNAVAILABLE"],
    [503, "SOURCE_UNAVAILABLE"],
  ])("maps HTTP %s to %s", async (status, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("failed", { status })),
    );
    await expect(safeGet("https://8.8.8.8/jobs")).rejects.toMatchObject({
      code,
      status,
      retryable: true,
    });
  });

  it("enforces declared and streamed response limits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("oversized", { status: 200, headers: { "content-length": "999" } }),
      ),
    );
    await expect(safeGet("https://8.8.8.8/jobs", { maximumBytes: 8 })).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.enqueue(new Uint8Array([5, 6, 7, 8]));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(stream, { status: 200, headers: { "content-type": "text/plain" } }),
      ),
    );
    await expect(safeGet("https://8.8.8.8/jobs", { maximumBytes: 7 })).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
  });

  it("handles empty bodies and rejects malformed JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const empty = await safeGet("https://8.8.8.8/jobs");
    expect(empty.body).toHaveLength(0);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );
    const malformed = await safeGet("https://8.8.8.8/jobs");
    expect(() => malformed.json()).toThrow(expect.objectContaining({ code: "INVALID_JSON" }));
  });

  it.each([
    ["TimeoutError", "SOURCE_TIMEOUT"],
    ["TypeError", "NETWORK_FAILED"],
  ])("maps %s fetch failures to %s", async (name, code) => {
    const error = new Error("safe test failure");
    error.name = name;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(error)),
    );
    await expect(safeGet("https://8.8.8.8/jobs")).rejects.toMatchObject({
      code,
      retryable: true,
    });
  });
});
