export type ContactCandidate = {
  id: string;
  name: string;
  title: string | null;
  team: string | null;
  relationshipStrength: number;
  relationshipStatus: string;
  lastInteractionAt: Date | null;
  referralStatus: string | null;
};

export type RecommendedContact = ContactCandidate & {
  score: number;
  reasons: string[];
};

const unavailableReferralStatuses = new Set(["declined", "expired", "completed"]);

export function recommendContact(
  candidates: ContactCandidate[],
  jobTitle = "",
  now = new Date(),
): RecommendedContact | null {
  const jobWords = new Set(
    jobTitle
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  const ranked = candidates
    .filter(
      (candidate) =>
        !candidate.referralStatus || !unavailableReferralStatuses.has(candidate.referralStatus),
    )
    .map((candidate) => {
      const reasons: string[] = [];
      let score = Math.max(1, Math.min(5, candidate.relationshipStrength)) * 10;
      reasons.push(`Relationship strength ${candidate.relationshipStrength}/5`);
      if (candidate.relationshipStatus === "current") {
        score += 20;
        reasons.push("Currently at the company");
      }
      const roleWords = `${candidate.title ?? ""} ${candidate.team ?? ""}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
      const overlap = roleWords.filter((word) => jobWords.has(word)).length;
      if (overlap) {
        score += Math.min(15, overlap * 5);
        reasons.push("Role or team is relevant to this job");
      }
      if (candidate.lastInteractionAt) {
        const ageDays = (now.getTime() - candidate.lastInteractionAt.getTime()) / 86_400_000;
        if (ageDays <= 30) {
          score += 15;
          reasons.push("Interaction within the last 30 days");
        } else if (ageDays <= 90) {
          score += 8;
          reasons.push("Interaction within the last 90 days");
        }
      }
      if (candidate.referralStatus === "agreed" || candidate.referralStatus === "submitted") {
        score += 15;
        reasons.push(`Referral ${candidate.referralStatus}`);
      }
      return { ...candidate, score, reasons };
    })
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        b.relationshipStrength - a.relationshipStrength ||
        a.name.localeCompare(b.name),
    );
  return ranked[0] ?? null;
}
