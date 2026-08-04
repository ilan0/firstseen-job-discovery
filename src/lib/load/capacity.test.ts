import { describe, expect, it } from "vitest";
import { forecastMonthlyExecutions, supplyCapacityState } from "./capacity";

describe("durable execution capacity breaker", () => {
  it("forecasts scans by monitoring tier", () => {
    expect(
      forecastMonthlyExecutions({
        prioritySources: 1,
        standardSources: 1,
        coldSources: 1,
        monthlyExecutionLimit: 1_000_000,
        usedExecutionsThisMonth: 0,
      }),
    ).toBe((96 + 24 + 6) * 3 * 30);
  });

  it("warns at 70%, blocks new cold sources at 85%, and protects priority cadence", () => {
    const state = supplyCapacityState({
      prioritySources: 0,
      standardSources: 0,
      coldSources: 0,
      monthlyExecutionLimit: 100,
      usedExecutionsThisMonth: 90,
    });
    expect(state).toMatchObject({
      warning: true,
      admitColdSources: false,
      priorityCadenceProtected: true,
    });
  });
});
