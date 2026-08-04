import type { ConnectorKind } from "@/connectors/versions";

export type ResolvedOfficialSource = {
  kind: ConnectorKind;
  tenantId: string | null;
  externalId: string | null;
  officialUrl: string;
};

// These tenants publish jobs for many unrelated employers. Their ATS pages are
// useful discovery signals, but they are not authoritative employer listings.
const NON_EMPLOYER_ATS_TENANTS = new Set(["jobgether"]);

function isAuthoritativeTenant(tenantId: string | null) {
  return tenantId !== null && !NON_EMPLOYER_ATS_TENANTS.has(tenantId.toLowerCase());
}

export function resolveOfficialSource(value: string): ResolvedOfficialSource | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(host)) {
    const tenantId = parts[0] ?? null;
    const jobsIndex = parts.indexOf("jobs");
    const externalId =
      jobsIndex >= 0
        ? (parts[jobsIndex + 1] ?? url.searchParams.get("gh_jid"))
        : url.searchParams.get("gh_jid");
    return isAuthoritativeTenant(tenantId)
      ? { kind: "greenhouse", tenantId, externalId, officialUrl: url.toString() }
      : null;
  }
  if (["jobs.lever.co", "jobs.eu.lever.co"].includes(host)) {
    const tenantId = parts[0] ?? null;
    return isAuthoritativeTenant(tenantId)
      ? {
          kind: "lever",
          tenantId,
          externalId: parts[1] ?? null,
          officialUrl: url.toString(),
        }
      : null;
  }
  if (host === "jobs.ashbyhq.com") {
    const tenantId = parts[0] ?? null;
    return isAuthoritativeTenant(tenantId)
      ? {
          kind: "ashby",
          tenantId,
          externalId: parts[1] ?? null,
          officialUrl: url.toString(),
        }
      : null;
  }
  if (/\b(?:jobs|careers|work-with-us|join-us)\b/i.test(url.pathname)) {
    return { kind: "custom_jsonld", tenantId: null, externalId: null, officialUrl: url.toString() };
  }
  return null;
}
