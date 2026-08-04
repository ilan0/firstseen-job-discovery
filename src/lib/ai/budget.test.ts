import { describe, expect, it } from "vitest";
import { canEscalateWithinCaps } from "./caps";

describe("Terra budget caps", () => {
  it("enforces both the listing and spend caps", () => {
    expect(
      canEscalateWithinCaps({
        routineCount: 50,
        escalationCount: 0,
        routineSpendUsd: 0.1,
        escalationSpendUsd: 0,
        estimateUsd: 0.016,
      }),
    ).toBe(true);
    expect(
      canEscalateWithinCaps({
        routineCount: 10,
        escalationCount: 1,
        routineSpendUsd: 0.02,
        escalationSpendUsd: 0.016,
        estimateUsd: 0.016,
      }),
    ).toBe(false);
    expect(
      canEscalateWithinCaps({
        routineCount: 50,
        escalationCount: 0,
        routineSpendUsd: 0.02,
        escalationSpendUsd: 0,
        estimateUsd: 0.016,
      }),
    ).toBe(false);
  });
});
