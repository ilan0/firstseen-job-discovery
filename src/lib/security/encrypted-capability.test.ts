// @vitest-environment node
import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptCapability, encryptCapability } from "./encrypted-capability";

vi.mock("server-only", () => ({}));

describe("encrypted capabilities", () => {
  it("round trips without leaving cleartext in storage", () => {
    const secret = randomBytes(32).toString("base64url");
    const cleartext = { endpoint: "https://fcm.googleapis.com/private", keys: { auth: "secret" } };
    const encrypted = encryptCapability(cleartext, secret);
    expect(encrypted).not.toContain("fcm.googleapis.com");
    expect(decryptCapability(encrypted, secret)).toEqual(cleartext);
  });

  it("rejects the wrong key and malformed values", () => {
    const encrypted = encryptCapability({ test: true }, randomBytes(32).toString("base64url"));
    expect(() => decryptCapability(encrypted, randomBytes(32).toString("base64url"))).toThrow();
    expect(() => decryptCapability("v0.invalid", randomBytes(32).toString("base64url"))).toThrow();
  });
});
