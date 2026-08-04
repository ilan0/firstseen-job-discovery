import { describe, expect, it } from "vitest";
import { assertSupportedPushEndpoint, pushCapabilitySchema } from "./push-capability";

describe("push capability validation", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/private",
    "https://updates.push.services.mozilla.com/wpush/v2/private",
    "https://web.push.apple.com/Q-private",
  ])("accepts a known browser push provider: %s", (endpoint) => {
    expect(assertSupportedPushEndpoint(endpoint)).toBe(endpoint);
  });

  it.each([
    "http://fcm.googleapis.com/private",
    "https://127.0.0.1/private",
    "https://attacker.test/private",
    "https://fcm.googleapis.com:8443/private",
  ])("rejects an unsafe or unsupported endpoint: %s", (endpoint) => {
    expect(() => assertSupportedPushEndpoint(endpoint)).toThrow();
  });

  it("requires browser key material", () => {
    expect(
      pushCapabilitySchema.safeParse({ endpoint: "https://fcm.googleapis.com/a", keys: {} })
        .success,
    ).toBe(false);
  });
});
