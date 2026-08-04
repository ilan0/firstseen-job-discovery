// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { resolveSafeRedirect } from "./redirect-resolver";

describe("safe discovery redirect resolution", () => {
  it("revalidates each hop and returns the final official URL without retaining a body", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://1.1.1.1/official" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("official", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );

    await expect(resolveSafeRedirect("https://8.8.8.8/start", { fetcher })).resolves.toEqual({
      url: "https://1.1.1.1/official",
      status: 200,
      contentType: "text/html",
      redirectCount: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["https://127.0.0.1/private", "PRIVATE_ADDRESS"],
    ["https://8.8.8.8:8443/jobs", "UNSAFE_URL"],
    ["https://user:pass@8.8.8.8/jobs", "UNSAFE_URL"],
  ])("rejects unsafe destination %s", async (url, code) => {
    await expect(resolveSafeRedirect(url)).rejects.toMatchObject({ code });
  });

  it("rejects loops, excessive hops, oversized redirect bodies, and unsafe content", async () => {
    await expect(
      resolveSafeRedirect("https://8.8.8.8/start", {
        fetcher: vi.fn(
          async () => new Response(null, { status: 302, headers: { location: "/start" } }),
        ),
      }),
    ).rejects.toMatchObject({ code: "REDIRECT_LOOP" });

    await expect(
      resolveSafeRedirect("https://8.8.8.8/start", {
        maximumRedirects: 0,
        fetcher: vi.fn(
          async () => new Response(null, { status: 302, headers: { location: "/next" } }),
        ),
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });

    await expect(
      resolveSafeRedirect("https://8.8.8.8/start", {
        fetcher: vi.fn(
          async () =>
            new Response(null, {
              status: 302,
              headers: { location: "/next", "content-length": "40000" },
            }),
        ),
      }),
    ).rejects.toMatchObject({ code: "REDIRECT_BODY_TOO_LARGE" });

    await expect(
      resolveSafeRedirect("https://8.8.8.8/start", {
        fetcher: vi.fn(
          async () =>
            new Response(new Uint8Array([1]), {
              status: 200,
              headers: { "content-type": "application/octet-stream" },
            }),
        ),
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT_TYPE" });
  });
});
