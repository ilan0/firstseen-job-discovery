import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ db: {} }));

describe("candidate runtime policy", () => {
  it("loads skills and matching policy from persisted profile-shaped data", async () => {
    const { parseCandidateRuntime } = await import("./runtime");
    const runtime = parseCandidateRuntime({
      userId: "user-1",
      profile: {
        monthsFullTimeExperience: 8,
        needsUsSponsorship: false,
        skills: {
          languages: ["TypeScript"],
          frameworksAndData: ["React"],
          aiAndTools: ["OpenAI API"],
        },
      },
      preferences: {
        fullTimeOnly: true,
        idealRequiredYearsMax: 1,
        eligibleRequiredYearsMax: 2,
        rejectClearance: true,
        rejectPublicTrust: true,
        acceptedAreas: [{ id: "south-florida", anchor: "Miami, FL", travelMinutes: 60 }],
        allowFullyRemote: true,
        rolePriorities: [{ family: "general_swe", priority: 1 }],
      },
    });

    expect(runtime.candidateSkills).toEqual(["TypeScript", "React", "OpenAI API"]);
    expect(runtime.eligibleRequiredYearsMax).toBe(2);
    expect(runtime.rolePriorities).toEqual([{ family: "general_swe", priority: 1 }]);
  });
});
