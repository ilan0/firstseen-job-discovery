import { describe, expect, it } from "vitest";
import { activeDiscoveryProviders, providerRights } from "./provider-policy";

describe("discovery provider rights", () => {
  it("uses Brave transiently and disables Adzuna by default", () => {
    expect(activeDiscoveryProviders()).toEqual(["brave"]);
    expect(providerRights.brave.mayPersistSearchResults).toBe(false);
    expect(providerRights.adzuna.mayResolveThirdPartyRedirects).toBe(false);
  });

  it("cannot enable a provider whose rights prohibit requests", () => {
    expect(activeDiscoveryProviders({ adzuna: true })).toEqual(["brave"]);
  });
});
