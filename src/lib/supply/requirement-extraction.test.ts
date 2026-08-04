// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobAnalysis } from "@/ai/schema";

const mocks = vi.hoisted(() => ({
  selectResponses: [] as unknown[][],
  insertResponses: [] as (unknown[] | Error)[],
  analyzeJob: vi.fn(),
  reserveAiBudget: vi.fn(),
  reserveAiEscalationBudget: vi.fn(),
  settleAiBudget: vi.fn(),
  releaseAiBudget: vi.fn(),
}));

vi.mock("server-only", () => ({}));

function chain<T>(terminal: () => T) {
  const value = {
    from: () => value,
    where: () => value,
    limit: () => Promise.resolve(terminal()),
    values: () => value,
    onConflictDoNothing: () => value,
    onConflictDoUpdate: () => value,
    returning: () => Promise.resolve(terminal()),
  };
  return value;
}

vi.mock("@/db/client", () => ({
  db: {
    select: () => chain(() => mocks.selectResponses.shift() ?? []),
    insert: () =>
      chain(() => {
        const response = mocks.insertResponses.shift() ?? [];
        if (response instanceof Error) throw response;
        return response;
      }),
  },
}));

vi.mock("@/lib/ai/budget", () => ({
  reserveAiBudget: mocks.reserveAiBudget,
  reserveAiEscalationBudget: mocks.reserveAiEscalationBudget,
  settleAiBudget: mocks.settleAiBudget,
  releaseAiBudget: mocks.releaseAiBudget,
}));

vi.mock("@/ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ai")>();
  return {
    ...original,
    analyzeJob: mocks.analyzeJob,
    jobAnalysisPromptHash: () => "prompt-hash",
  };
});

import {
  extractSharedRequirements,
  runSharedRequirementExtractionWorkflow,
} from "./requirement-extraction";

function analysis(overrides: Partial<JobAnalysis> = {}): JobAnalysis {
  return {
    employment: { value: "full_time", confidence: "high", evidence: [] },
    experienceRequirements: [],
    clearance: { value: "not_mentioned", confidence: "high", evidence: [] },
    publicTrust: { value: "not_mentioned", confidence: "high", evidence: [] },
    sponsorship: { value: "not_mentioned", confidence: "high", evidence: [] },
    workArrangement: { value: "fully_remote", confidence: "high", evidence: [] },
    locations: { value: ["United States"], confidence: "high", evidence: [] },
    roleFamily: { value: "general_swe", confidence: "high", evidence: [] },
    requiredSkills: [],
    preferredSkills: [],
    candidateStrengths: [],
    candidateWeaknesses: [],
    summary: "Candidate-neutral fixture.",
    extractionWarnings: [],
    ...overrides,
  };
}

function result(value: JobAnalysis, model = "gpt-5.6-luna") {
  return {
    analysis: value,
    model,
    schemaVersion: "2026-08-04.2",
    promptHash: "prompt-hash",
    usage: { inputTokens: 100, cachedInputTokens: 10, outputTokens: 20 },
    estimatedCostUsd: 0.001,
    latencyMs: 100,
    responseId: `response-${model}`,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    snapshotId: "00000000-0000-4000-8000-000000000002",
    status: "succeeded",
    model: "gpt-5.6-luna",
    escalationModel: null,
    unresolvedFields: [],
    schemaVersion: "2026-08-04.2",
    promptHash: "prompt-hash",
    extractionVersion: "shared-requirements-v1",
    structuredOutput: analysis(),
    confidence: 95,
    inputTokens: 100,
    cachedInputTokens: 10,
    outputTokens: 20,
    estimatedCostUsd: "0.001000",
    actualCostUsd: "0.001000",
    latencyMs: 100,
    errorCode: null,
    completedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const options = {
  snapshotId: "00000000-0000-4000-8000-000000000002",
  budgetUserId: "00000000-0000-4000-8000-000000000003",
  listing: {
    externalId: "job-1",
    requisitionId: "job-1",
    title: "Software Engineer I",
    descriptionText: "Full-time role with one year of experience.",
    officialUrl: "https://jobs.example.test/job-1",
    applyUrl: "https://jobs.example.test/job-1",
    locations: ["United States"],
    workplaceType: "Remote",
    employmentType: "Full-time",
    postedAt: "2026-08-04T12:00:00.000Z",
    postedAtConfidence: "high" as const,
    salaryText: null,
    sourceConfidence: "high" as const,
    rawMetadata: {},
  },
};

describe("shared requirement extraction orchestration", () => {
  beforeEach(() => {
    mocks.selectResponses.length = 0;
    mocks.insertResponses.length = 0;
    vi.clearAllMocks();
    mocks.reserveAiBudget.mockResolvedValue("reservation-routine");
    mocks.reserveAiEscalationBudget.mockResolvedValue(null);
  });

  it("returns a valid cached extraction without reserving budget", async () => {
    mocks.selectResponses.push([row()]);

    await expect(extractSharedRequirements(options)).resolves.toMatchObject({
      status: "succeeded",
      model: "gpt-5.6-luna",
    });
    expect(mocks.reserveAiBudget).not.toHaveBeenCalled();
  });

  it("persists a budget-blocked decision without calling the model", async () => {
    mocks.selectResponses.push([]);
    mocks.insertResponses.push([
      row({ status: "budget_blocked", structuredOutput: null, errorCode: "MONTHLY_BUDGET_LIMIT" }),
    ]);
    mocks.reserveAiBudget.mockResolvedValue(null);

    await expect(extractSharedRequirements(options)).resolves.toMatchObject({
      status: "budget_blocked",
      analysis: null,
      errorCode: "MONTHLY_BUDGET_LIMIT",
    });
    expect(mocks.analyzeJob).not.toHaveBeenCalled();
  });

  it("settles one routine extraction and stores high-confidence output", async () => {
    mocks.selectResponses.push([]);
    mocks.insertResponses.push([row()]);
    mocks.analyzeJob.mockResolvedValue(result(analysis()));

    await expect(extractSharedRequirements(options)).resolves.toMatchObject({
      status: "succeeded",
      unresolvedFields: [],
    });
    expect(mocks.settleAiBudget).toHaveBeenCalledOnce();
    expect(mocks.reserveAiEscalationBudget).not.toHaveBeenCalled();
  });

  it("retries and replaces a failed cached extraction", async () => {
    mocks.selectResponses.push([]);
    mocks.insertResponses.push([
      row({ status: "failed", structuredOutput: null, errorCode: "API_CONNECTION_ERROR" }),
    ]);
    mocks.analyzeJob.mockRejectedValueOnce(new Error("temporary connection failure"));

    await expect(extractSharedRequirements(options)).resolves.toMatchObject({
      status: "failed",
      errorCode: "API_CONNECTION_ERROR",
    });

    mocks.selectResponses.push([
      row({ status: "failed", structuredOutput: null, errorCode: "API_CONNECTION_ERROR" }),
    ]);
    mocks.insertResponses.push([row()]);
    mocks.analyzeJob.mockResolvedValueOnce(result(analysis()));

    await expect(extractSharedRequirements(options)).resolves.toMatchObject({
      status: "succeeded",
      errorCode: null,
    });
    expect(mocks.analyzeJob).toHaveBeenCalledTimes(2);
  });

  it("retries a previously budget-blocked extraction when capacity is available", async () => {
    mocks.selectResponses.push([
      row({
        status: "budget_blocked",
        structuredOutput: null,
        errorCode: "MONTHLY_BUDGET_LIMIT",
      }),
    ]);
    mocks.insertResponses.push([row()]);
    mocks.analyzeJob.mockResolvedValueOnce(result(analysis()));

    await expect(extractSharedRequirements(options)).resolves.toMatchObject({
      status: "succeeded",
      errorCode: null,
    });
    expect(mocks.reserveAiBudget).toHaveBeenCalledOnce();
    expect(mocks.analyzeJob).toHaveBeenCalledOnce();
  });

  it("selectively escalates uncertain hard fields and accounts for both passes", async () => {
    const luna = analysis({
      sponsorship: { value: "uncertain", confidence: "low", evidence: [] },
      extractionWarnings: ["Ambiguous work authorization language."],
    });
    const terra = analysis({
      sponsorship: { value: "incompatible", confidence: "high", evidence: [] },
    });
    mocks.selectResponses.push([]);
    mocks.insertResponses.push([
      row({
        escalationModel: "gpt-5.6-terra",
        unresolvedFields: ["sponsorship"],
        structuredOutput: terra,
        inputTokens: 200,
        cachedInputTokens: 20,
        outputTokens: 40,
        latencyMs: 200,
      }),
    ]);
    mocks.reserveAiEscalationBudget.mockResolvedValue("reservation-terra");
    mocks.analyzeJob
      .mockResolvedValueOnce(result(luna))
      .mockResolvedValueOnce(result(terra, "gpt-5.6-terra"));

    await expect(extractSharedRequirements(options)).resolves.toMatchObject({
      status: "succeeded",
      unresolvedFields: ["sponsorship"],
    });
    expect(mocks.analyzeJob).toHaveBeenCalledTimes(2);
    expect(mocks.settleAiBudget).toHaveBeenCalledTimes(2);
  });

  it("releases a failed escalation while preserving the routine result", async () => {
    const uncertain = analysis({
      experienceRequirements: [
        {
          text: "Equivalent experience accepted",
          kind: "required",
          minimumYears: null,
          maximumYears: null,
          alternativePath: true,
          confidence: "medium",
          evidence: [],
        },
      ],
    });
    mocks.selectResponses.push([]);
    mocks.insertResponses.push([row({ structuredOutput: uncertain, confidence: 72 })]);
    mocks.reserveAiEscalationBudget.mockResolvedValue("reservation-terra");
    mocks.analyzeJob
      .mockResolvedValueOnce(result(uncertain))
      .mockRejectedValueOnce(new TypeError("provider timeout"));

    await expect(extractSharedRequirements(options)).resolves.toMatchObject({
      status: "succeeded",
      unresolvedFields: [],
    });
    expect(mocks.releaseAiBudget).toHaveBeenCalledWith("reservation-terra", "TYPEERROR");
  });

  it("records a minimized failure and releases the routine reservation", async () => {
    mocks.selectResponses.push([]);
    mocks.insertResponses.push([
      row({ status: "failed", structuredOutput: null, errorCode: "AI_FAILED" }),
    ]);
    mocks.analyzeJob.mockRejectedValue("non-error failure");

    await expect(extractSharedRequirements(options)).resolves.toMatchObject({
      status: "failed",
      analysis: null,
      errorCode: "AI_FAILED",
    });
    expect(mocks.releaseAiBudget).toHaveBeenCalledWith("reservation-routine", "AI_FAILED");
  });

  it("reuses the paid model step when downstream persistence is replayed", async () => {
    mocks.selectResponses.push([]);
    mocks.insertResponses.push(new Error("database unavailable"), [row()]);
    mocks.analyzeJob.mockResolvedValue(result(analysis()));
    const memoized = new Map<string, unknown>();
    const durableStep = async <T>(name: string, operation: () => Promise<T>) => {
      if (memoized.has(name)) return memoized.get(name) as T;
      const value = await operation();
      memoized.set(name, value);
      return value;
    };

    await expect(runSharedRequirementExtractionWorkflow(options, durableStep)).rejects.toThrow(
      "database unavailable",
    );
    await expect(
      runSharedRequirementExtractionWorkflow(options, durableStep),
    ).resolves.toMatchObject({ status: "succeeded" });

    expect(mocks.analyzeJob).toHaveBeenCalledOnce();
    expect(mocks.insertResponses).toHaveLength(0);
  });
});
