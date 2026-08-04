// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { SafeGet, SafeResponse } from "@/connectors/http";
import { verifyStructuredJobAuthority } from "./structured-authority";

function response(html: string): SafeResponse {
  const body = new TextEncoder().encode(html);
  return {
    status: 200,
    url: "https://acme.example/careers/software-engineer",
    headers: new Headers({ "content-type": "text/html" }),
    body,
    text: () => html,
    json: <T>() => JSON.parse(html) as T,
  };
}

function posting(organization: unknown) {
  return `<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "Software Engineer I",
    description: "Full-time role with one year of experience.",
    identifier: "SWE-1",
    hiringOrganization: organization,
  })}</script>`;
}

describe("structured employer authority", () => {
  it("accepts independently verified JobPosting data with one hiring organization", async () => {
    const get = vi.fn<SafeGet>().mockResolvedValue(response(posting({ name: "Acme Labs" })));

    await expect(
      verifyStructuredJobAuthority("https://acme.example/careers/software-engineer", get),
    ).resolves.toMatchObject({
      companyName: "Acme Labs",
      confidence: 90,
      publicConfig: { expectedOrganization: "Acme Labs", requireHiringOrganization: true },
      evidence: { kind: "official_structured_job", listingCount: 1 },
    });
  });

  it("rejects absent or conflicting hiring-organization evidence", async () => {
    const absent = vi.fn<SafeGet>().mockResolvedValue(response(posting(undefined)));
    const conflicting = vi
      .fn<SafeGet>()
      .mockResolvedValue(response(`${posting("Acme Labs")}${posting("Other Company")}`));

    await expect(
      verifyStructuredJobAuthority("https://acme.example/careers/software-engineer", absent),
    ).resolves.toBeNull();
    await expect(
      verifyStructuredJobAuthority("https://acme.example/careers/software-engineer", conflicting),
    ).resolves.toBeNull();
  });
});
