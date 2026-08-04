import type { SafeGet } from "@/connectors/http";
import { JsonLdConnector } from "@/connectors/official/jsonld";

export type StructuredSourceAuthority = {
  companyName: string;
  officialUrl: string;
  confidence: number;
  publicConfig: Record<string, unknown>;
  evidence: {
    kind: "official_structured_job";
    sourceUrl: string;
    listingCount: number;
  };
};

function normalizeOrganization(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function verifyStructuredJobAuthority(
  officialUrl: string,
  get?: SafeGet,
): Promise<StructuredSourceAuthority | null> {
  const connector = new JsonLdConnector(get);
  const page = await connector.discover({
    id: "provisional-structured-source",
    kind: "custom_jsonld",
    companyName: "Provisional employer",
    baseUrl: officialUrl,
  });
  const organizations = new Map<string, string>();
  for (const listing of page.listings) {
    const organization = listing.rawMetadata.hiringOrganization;
    if (typeof organization !== "string" || !organization.trim()) return null;
    organizations.set(normalizeOrganization(organization), organization.trim());
  }
  if (organizations.size !== 1) return null;
  const companyName = [...organizations.values()][0];
  if (!companyName) return null;
  return {
    companyName,
    officialUrl,
    confidence: 90,
    publicConfig: {
      expectedOrganization: companyName,
      requireHiringOrganization: true,
    },
    evidence: {
      kind: "official_structured_job",
      sourceUrl: officialUrl,
      listingCount: page.listings.length,
    },
  };
}
