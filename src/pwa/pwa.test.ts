// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

function pngSize(path: string) {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("PWA static contract", () => {
  it("declares standalone install metadata and complete icon sizes", () => {
    const value = manifest();
    expect(value).toMatchObject({ display: "standalone", start_url: "/", scope: "/" });
    expect(value.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192" }),
        expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
      ]),
    );
    expect(pngSize("public/icons/icon-192.png")).toEqual({ width: 192, height: 192 });
    expect(pngSize("public/icons/icon-512.png")).toEqual({ width: 512, height: 512 });
  });

  it("never puts authenticated navigation or API responses in Cache Storage", () => {
    const worker = readFileSync("public/sw.js", "utf8");
    expect(worker).toContain('const STATIC_ASSETS = ["/icons/icon-192.png"');
    expect(worker).toContain("const OFFLINE_HTML");
    expect(worker).toContain('"Cache-Control": "no-store"');
    expect(worker).not.toMatch(/cache\.put\s*\(/);
    expect(worker).not.toMatch(/cache\.match\s*\(event\.request/);
    expect(worker).toContain('event.request.mode !== "navigate"');
    expect(worker).not.toContain("self.clients.claim()");
    expect(worker).toContain('key.startsWith("firstseen-static-")');
    expect(worker).not.toMatch(/keys\.filter\(\(key\) => key !== CACHE_VERSION/);
  });

  it("validates notification click paths as same-origin relative paths", () => {
    const worker = readFileSync("public/sw.js", "utf8");
    expect(worker).toContain('value.startsWith("//")');
    expect(worker).toContain('value.includes("\\\\")');
    expect(worker).toContain("destination.origin === self.location.origin");
    expect(worker).toContain("new URL(path, self.location.origin)");
  });
});
