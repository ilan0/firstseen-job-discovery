import { describe, expect, it } from "vitest";
import { isSourceNetworkDisabled } from "./source-policy";

describe("source network policy", () => {
  it("disables only sources carrying the explicit boolean fixture flag", () => {
    expect(isSourceNetworkDisabled({ fixture: "browser", networkDisabled: true })).toBe(true);
    expect(isSourceNetworkDisabled({ fixture: "browser", networkDisabled: false })).toBe(false);
    expect(isSourceNetworkDisabled({ networkDisabled: "true" })).toBe(false);
    expect(isSourceNetworkDisabled(null)).toBe(false);
  });
});
