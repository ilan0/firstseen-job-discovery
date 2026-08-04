import { describe, expect, it } from "vitest";
import {
  assertApplicationTransition,
  canTransitionApplication,
  nextApplicationStages,
} from "./stages";

describe("application stage transitions", () => {
  it("supports the intended forward funnel", () => {
    expect(canTransitionApplication("applied", "recruiter_screen")).toBe(true);
    expect(canTransitionApplication("recruiter_screen", "interview")).toBe(true);
    expect(canTransitionApplication("interview", "final")).toBe(true);
    expect(canTransitionApplication("final", "offer")).toBe(true);
  });

  it("allows rejection or withdrawal but rejects skips and terminal changes", () => {
    expect(nextApplicationStages("applied")).toContain("rejected");
    expect(() => assertApplicationTransition("applied", "offer")).toThrow(/cannot move/);
    expect(() => assertApplicationTransition("rejected", "interview")).toThrow(/cannot move/);
  });
});
