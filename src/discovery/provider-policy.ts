export type DiscoveryProvider = "brave" | "adzuna";

export type ProviderRights = {
  enabledByDefault: boolean;
  mayRequest: boolean;
  mayUseTransiently: boolean;
  mayPersistSearchResults: boolean;
  mayResolveThirdPartyRedirects: boolean;
  durableFields: readonly ("provider" | "firstObservedAt")[];
  rationale: string;
};

export const providerRights: Record<DiscoveryProvider, ProviderRights> = {
  brave: {
    enabledByDefault: true,
    mayRequest: true,
    mayUseTransiently: true,
    mayPersistSearchResults: false,
    mayResolveThirdPartyRedirects: true,
    durableFields: ["provider", "firstObservedAt"],
    rationale:
      "Standard Search API results are transient sensors; only independently verified official facts persist.",
  },
  adzuna: {
    enabledByDefault: false,
    mayRequest: false,
    mayUseTransiently: false,
    mayPersistSearchResults: false,
    mayResolveThirdPartyRedirects: false,
    durableFields: [],
    rationale:
      "Automated offsite verification remains disabled until written permission or suitable license terms exist.",
  },
};

export function activeDiscoveryProviders(
  overrides: Partial<Record<DiscoveryProvider, boolean>> = {},
): DiscoveryProvider[] {
  return (Object.keys(providerRights) as DiscoveryProvider[]).filter((provider) => {
    const rights = providerRights[provider];
    const enabled = overrides[provider] ?? rights.enabledByDefault;
    return enabled && rights.mayRequest && rights.mayUseTransiently;
  });
}
