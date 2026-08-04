export const applicationStages = [
  "applied",
  "recruiter_screen",
  "interview",
  "final",
  "offer",
  "rejected",
  "withdrawn",
] as const;

export type ApplicationStage = (typeof applicationStages)[number];

const allowedTransitions: Record<ApplicationStage, ReadonlySet<ApplicationStage>> = {
  applied: new Set(["recruiter_screen", "interview", "final", "offer", "rejected", "withdrawn"]),
  recruiter_screen: new Set(["interview", "final", "offer", "rejected", "withdrawn"]),
  interview: new Set(["final", "offer", "rejected", "withdrawn"]),
  final: new Set(["offer", "rejected", "withdrawn"]),
  offer: new Set(["withdrawn"]),
  rejected: new Set(),
  withdrawn: new Set(),
};

export function canTransitionApplication(from: ApplicationStage, to: ApplicationStage) {
  return allowedTransitions[from].has(to);
}

export function assertApplicationTransition(from: ApplicationStage, to: ApplicationStage) {
  if (!canTransitionApplication(from, to))
    throw new Error(`Application cannot move from ${from} to ${to}.`);
}

export function nextApplicationStages(from: ApplicationStage): ApplicationStage[] {
  return [...allowedTransitions[from]];
}
