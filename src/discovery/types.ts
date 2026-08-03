export type DiscoveryCandidate = {
  sensor: "brave" | "adzuna";
  sensorId: string;
  discoveredUrl: string;
  titleHint: string;
  companyHint: string | null;
  locationHint: string | null;
  descriptionHint: string | null;
  discoveredAt: string;
  sensorPostedAt: string | null;
  sensorMetadata: Record<string, string | number | boolean | null>;
};

export type DiscoveryQuery = {
  roleQuery: string;
  locationQuery: string;
  remote: boolean;
};

export interface DiscoverySensor {
  readonly kind: DiscoveryCandidate["sensor"];
  search(query: DiscoveryQuery, signal?: AbortSignal): Promise<DiscoveryCandidate[]>;
}
