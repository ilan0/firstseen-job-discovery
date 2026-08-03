import type { ConnectorKind } from "@/connectors/versions";

export type ResolvedOfficialSource = {
  kind: ConnectorKind;
  tenantId: string | null;
  externalId: string | null;
  officialUrl: string;
};

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
    return tenantId
      ? { kind: "greenhouse", tenantId, externalId, officialUrl: url.toString() }
      : null;
  }
  if (["jobs.lever.co", "jobs.eu.lever.co"].includes(host)) {
    return parts[0]
      ? {
          kind: "lever",
          tenantId: parts[0],
          externalId: parts[1] ?? null,
          officialUrl: url.toString(),
        }
      : null;
  }
  if (host === "jobs.ashbyhq.com") {
    return parts[0]
      ? {
          kind: "ashby",
          tenantId: parts[0],
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
