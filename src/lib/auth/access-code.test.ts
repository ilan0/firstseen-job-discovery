// @vitest-environment node
import { describe, expect, it } from "vitest";
import { accessCodePattern, hashAccessCode, verifyAccessCode } from "./access-code";

describe("access-code credentials", () => {
  it("accepts exactly four ASCII digits", () => {
    expect(accessCodePattern.test("3385")).toBe(true);
    expect(accessCodePattern.test("338")).toBe(false);
    expect(accessCodePattern.test("33850")).toBe(false);
    expect(accessCodePattern.test("33a5")).toBe(false);
    expect(accessCodePattern.test("１２３４")).toBe(false);
  });

  it("hashes and verifies without storing the code", async () => {
    const encoded = await hashAccessCode("3385", Buffer.alloc(16, 7));
    expect(encoded).not.toContain("3385");
    await expect(verifyAccessCode("3385", encoded)).resolves.toBe(true);
    await expect(verifyAccessCode("3384", encoded)).resolves.toBe(false);
  });

  it("fails closed for malformed codes and hashes", async () => {
    await expect(verifyAccessCode("338", "invalid")).resolves.toBe(false);
    await expect(verifyAccessCode("3385", "invalid")).resolves.toBe(false);
    await expect(verifyAccessCode("3385", "v1.16384.8.1.c2hvcnQ.c2hvcnQ")).resolves.toBe(false);
    await expect(hashAccessCode("abcd")).rejects.toThrow("exactly four digits");
  });
});
