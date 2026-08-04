// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("source scan failure codes", () => {
  it("preserves a structured connector code", async () => {
    const { sourceFailureCode } = await import("./failure-code");
    expect(sourceFailureCode({ code: "ASHBY_SCHEMA_ERROR" })).toBe("ASHBY_SCHEMA_ERROR");
  });

  it("finds a connector code nested in a non-retriable wrapper", async () => {
    const { sourceFailureCode } = await import("./failure-code");
    expect(
      sourceFailureCode({ name: "NonRetriableError", cause: { code: "RESPONSE_TOO_LARGE" } }),
    ).toBe("RESPONSE_TOO_LARGE");
  });

  it("recovers a safe connector code after the worker provider serializes the wrapper", async () => {
    const { sourceFailureCode } = await import("./failure-code");
    expect(sourceFailureCode(new Error("[CONNECTOR_PAGINATION_LIMIT] Source is oversized."))).toBe(
      "CONNECTOR_PAGINATION_LIMIT",
    );
  });

  it("normalizes an unstructured failure name for safe persistence", async () => {
    const { sourceFailureCode } = await import("./failure-code");
    expect(
      sourceFailureCode(Object.assign(new Error("private details"), { name: "Fetch Error" })),
    ).toBe("FETCH_ERROR");
  });
});
