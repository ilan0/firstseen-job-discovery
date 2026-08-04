import { describe, expect, it } from "vitest";
import { safeAppPath } from "./app-path";

describe("same-origin app paths", () => {
  it.each([
    ["/jobs/123?from=push#fit", "/jobs/123?from=push#fit"],
    ["/", "/"],
  ])("accepts and normalizes an internal path", (value, expected) => {
    expect(safeAppPath(value)).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/%5c%5cevil.example",
    "/%2f%2fevil.example",
    "/%252f%252fevil.example",
    "/jobs/%E0%A4%A",
    "/jobs/1\nLocation:https://evil.example",
  ])("rejects redirect-like or malformed input: %s", (value) => {
    expect(safeAppPath(value)).toBeNull();
  });
});
