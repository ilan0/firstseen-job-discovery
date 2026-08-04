// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    selectResponses: [] as unknown[][],
    saved: [] as Array<Record<string, unknown>>,
  };
  function selectable(terminal: () => unknown[]) {
    const value = {
      from: () => value,
      innerJoin: () => value,
      where: () => value,
      limit: () => Promise.resolve(terminal()),
      then: (resolve: (result: unknown[]) => unknown) => Promise.resolve(terminal()).then(resolve),
    };
    return value;
  }
  const db = {
    select: () => selectable(() => state.selectResponses.shift() ?? []),
    update: () => {
      const value = {
        set: (saved: Record<string, unknown>) => {
          state.saved.push(saved);
          return value;
        },
        where: () => Promise.resolve([]),
      };
      return value;
    },
  };
  return Object.assign(state, { db });
});

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ db: mocks.db }));

import { refreshCompanyMonitoring } from "./monitoring";

const userId = "00000000-0000-4000-8000-000000000001";
const companyId = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-04T12:00:00Z");

function watch(overrides: Record<string, unknown> = {}) {
  return {
    scope: "discovered",
    monitoringTier: "cold",
    cadenceMinutes: 240,
    nextScanAt: new Date("2026-08-04T16:00:00Z"),
    ...overrides,
  };
}

describe("persisted company monitoring refresh", () => {
  beforeEach(() => {
    mocks.selectResponses.length = 0;
    mocks.saved.length = 0;
  });

  it("does nothing when the owner has no active company or watch", async () => {
    mocks.selectResponses.push([], []);
    await expect(refreshCompanyMonitoring(userId, companyId, now)).resolves.toBeNull();
    expect(mocks.saved).toEqual([]);
  });

  it("promotes an interested company immediately to priority cadence", async () => {
    mocks.selectResponses.push([{ interested: true }], [watch()], [], []);

    await expect(refreshCompanyMonitoring(userId, companyId, now)).resolves.toMatchObject({
      tier: "priority",
      cadenceMinutes: 15,
      active: true,
    });
    expect(mocks.saved[0]).toMatchObject({
      monitoringTier: "priority",
      cadenceMinutes: 15,
      nextScanAt: now,
    });
  });

  it("keeps an agreed referral company on priority cadence", async () => {
    mocks.selectResponses.push([{ interested: false }], [watch()], [{ id: "agreed-referral" }], []);

    await expect(refreshCompanyMonitoring(userId, companyId, now)).resolves.toMatchObject({
      tier: "priority",
      cadenceMinutes: 15,
      active: true,
    });
    expect(mocks.saved[0]).toMatchObject({
      monitoringTier: "priority",
      cadenceMinutes: 15,
      nextScanAt: now,
    });
  });

  it("warms a discovered company only for a recent viable eligible match", async () => {
    mocks.selectResponses.push(
      [{ interested: false }],
      [watch()],
      [],
      [
        {
          band: "strong",
          eligibilityOutcome: "eligible",
          postedAt: new Date("2026-08-04T10:00:00Z"),
          postedAtConfidence: "high",
          firstSeenAt: new Date("2026-08-04T10:05:00Z"),
          reopenedAt: null,
        },
      ],
    );

    await expect(refreshCompanyMonitoring(userId, companyId, now)).resolves.toMatchObject({
      tier: "warm",
      cadenceMinutes: 60,
    });
    expect(mocks.saved[0]?.nextScanAt).toEqual(now);
  });

  it("returns a nonviable discovered watch to cold without delaying past its new cadence", async () => {
    mocks.selectResponses.push(
      [{ interested: false }],
      [watch({ monitoringTier: "warm", cadenceMinutes: 60, nextScanAt: now })],
      [],
      [
        {
          band: "not_recommended",
          eligibilityOutcome: "ineligible",
          postedAt: new Date("2026-05-01T10:00:00Z"),
          postedAtConfidence: "high",
          firstSeenAt: new Date("2026-05-01T10:05:00Z"),
          reopenedAt: null,
        },
      ],
    );

    await expect(refreshCompanyMonitoring(userId, companyId, now)).resolves.toMatchObject({
      tier: "cold",
      cadenceMinutes: 240,
    });
    expect(mocks.saved[0]?.nextScanAt).toEqual(new Date("2026-08-04T16:00:00Z"));
  });

  it("keeps quarantined watches inactive and preserves an unchanged next scan", async () => {
    const nextScanAt = new Date("2026-08-05T12:00:00Z");
    mocks.selectResponses.push(
      [{ interested: false }],
      [watch({ monitoringTier: "quarantined", cadenceMinutes: 0, nextScanAt })],
      [{ id: "active-referral" }],
      [],
    );

    await expect(refreshCompanyMonitoring(userId, companyId, now)).resolves.toMatchObject({
      tier: "quarantined",
      active: false,
    });
    expect(mocks.saved[0]?.nextScanAt).toEqual(nextScanAt);
  });
});
