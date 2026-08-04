import { describe, expect, it } from "vitest";
import { recommendContact, type ContactCandidate } from "./best-contact";

const base: ContactCandidate = {
  id: "a",
  name: "Alex",
  title: "Software Engineer",
  team: "Platform",
  relationshipStrength: 3,
  relationshipStatus: "current",
  lastInteractionAt: null,
  referralStatus: "available",
};

describe("recommendContact", () => {
  it("uses relationship, company status, relevance, and recency deterministically", () => {
    const result = recommendContact(
      [
        base,
        {
          ...base,
          id: "b",
          name: "Blair",
          relationshipStrength: 4,
          lastInteractionAt: new Date("2026-07-20T00:00:00Z"),
        },
      ],
      "Backend Software Engineer",
      new Date("2026-08-04T00:00:00Z"),
    );
    expect(result).toMatchObject({ id: "b" });
    expect(result?.reasons).toContain("Interaction within the last 30 days");
  });

  it("does not recommend declined, expired, or completed requests", () => {
    expect(recommendContact([{ ...base, referralStatus: "declined" }])).toBeNull();
  });

  it("breaks exact ties by name", () => {
    expect(
      recommendContact([
        { ...base, name: "Zoe" },
        { ...base, id: "b", name: "Ada" },
      ])?.name,
    ).toBe("Ada");
  });

  it("accounts for medium recency, role overlap, referral readiness, and bounded strength", () => {
    const result = recommendContact(
      [
        {
          ...base,
          relationshipStrength: 99,
          title: "Backend Engineer",
          relationshipStatus: "former",
          lastInteractionAt: new Date("2026-06-01T00:00:00Z"),
          referralStatus: "agreed",
        },
      ],
      "Backend Software Engineer",
      new Date("2026-08-04T00:00:00Z"),
    );
    expect(result?.reasons).toEqual(
      expect.arrayContaining([
        "Role or team is relevant to this job",
        "Interaction within the last 90 days",
        "Referral agreed",
      ]),
    );
    expect(result?.score).toBeGreaterThan(50);
  });

  it("returns null for no contacts and ignores old interactions", () => {
    expect(recommendContact([])).toBeNull();
    expect(
      recommendContact(
        [{ ...base, lastInteractionAt: new Date("2025-01-01T00:00:00Z") }],
        "Unrelated role",
        new Date("2026-08-04T00:00:00Z"),
      )?.reasons,
    ).not.toContain("Interaction within the last 90 days");
  });
});
