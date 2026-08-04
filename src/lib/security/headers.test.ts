import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

describe("security headers", () => {
  it("does not upgrade local development requests to HTTPS", async () => {
    const headers = await nextConfig.headers?.();
    const policy = headers?.[0]?.headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;

    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});
