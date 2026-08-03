import type { NormalizedListing } from "@/connectors/types";
import type { ConnectorKind } from "@/connectors/versions";
import { normalizeOfficialUrl, normalizeTitle, sha256, stableJson } from "./normalize";

export type IdentityInput = {
  connectorKind: ConnectorKind;
  tenantId: string | null;
  companyDomain: string;
  listing: NormalizedListing;
};

export type JobFingerprint = {
  kind: "ats_external_id" | "requisition" | "official_url" | "fallback";
  fingerprint: string;
  confidence: number;
};

export function jobFingerprints(input: IdentityInput): JobFingerprint[] {
  const fingerprints: JobFingerprint[] = [];
  if (input.tenantId && input.listing.externalId) {
    fingerprints.push({
      kind: "ats_external_id",
      fingerprint: sha256(
        `${input.connectorKind}:${input.tenantId.toLowerCase()}:${input.listing.externalId}`,
      ),
      confidence: 100,
    });
  }
  if (input.listing.requisitionId) {
    fingerprints.push({
      kind: "requisition",
      fingerprint: sha256(`${input.companyDomain.toLowerCase()}:${input.listing.requisitionId}`),
      confidence: 95,
    });
  }
  fingerprints.push({
    kind: "official_url",
    fingerprint: sha256(normalizeOfficialUrl(input.listing.officialUrl)),
    confidence: 90,
  });
  fingerprints.push({
    kind: "fallback",
    fingerprint: sha256(
      stableJson({
        company: input.companyDomain.toLowerCase(),
        title: normalizeTitle(input.listing.title),
        locations: input.listing.locations.map((location) => location.toLowerCase()).sort(),
      }),
    ),
    confidence: 65,
  });
  return fingerprints;
}

export function canonicalIdentity(input: IdentityInput): JobFingerprint {
  return jobFingerprints(input)[0]!;
}
