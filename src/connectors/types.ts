import type { ConnectorKind } from "./versions";

export type SourceConfidence = "low" | "medium" | "high";

export type ConnectorSource = {
  id: string;
  kind: ConnectorKind;
  companyName: string;
  baseUrl: string;
  tenantId?: string | null;
  publicConfig?: Record<string, unknown>;
  etag?: string | null;
  lastModified?: string | null;
};

export type NormalizedListing = {
  externalId: string | null;
  requisitionId: string | null;
  title: string;
  descriptionText: string;
  officialUrl: string;
  applyUrl: string;
  locations: string[];
  workplaceType: string | null;
  employmentType: string | null;
  postedAt: string | null;
  postedAtConfidence: SourceConfidence;
  salaryText: string | null;
  sourceConfidence: SourceConfidence;
  rawMetadata: Record<string, unknown>;
};

export type DiscoveryPage = {
  listings: NormalizedListing[];
  nextCursor: string | null;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
};

export type VerificationResult =
  | { state: "open"; listing: NormalizedListing }
  | { state: "closed"; evidence: string }
  | { state: "uncertain"; evidence: string };

export type ConnectorContext = {
  signal?: AbortSignal;
  cursor?: string | null;
};

export interface JobConnector {
  readonly kind: ConnectorKind;
  readonly version: string;
  discover(source: ConnectorSource, context?: ConnectorContext): Promise<DiscoveryPage>;
  verify(
    source: ConnectorSource,
    officialUrl: string,
    externalId?: string | null,
    context?: ConnectorContext,
  ): Promise<VerificationResult>;
}

export type SourceRunResult =
  | { ok: true; sourceId: string; page: DiscoveryPage; durationMs: number }
  | {
      ok: false;
      sourceId: string;
      errorCode: string;
      safeMessage: string;
      retryable: boolean;
      durationMs: number;
    };
