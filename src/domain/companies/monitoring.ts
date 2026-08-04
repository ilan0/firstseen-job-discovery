export type CompanyScope = "personal" | "discovered";
export type MonitoringTier = "priority" | "standard" | "warm" | "cold" | "quarantined";

export const monitoringCadenceMinutes: Record<MonitoringTier, number> = {
  priority: 15,
  standard: 60,
  warm: 60,
  cold: 240,
  quarantined: 240,
};

export function deriveMonitoringPolicy(input: {
  scope: CompanyScope;
  interested: boolean;
  hasActiveReferral: boolean;
  hasRecentViableMatch?: boolean;
  quarantined?: boolean;
}): { tier: MonitoringTier; cadenceMinutes: number; active: boolean } {
  const tier: MonitoringTier = input.quarantined
    ? "quarantined"
    : input.interested || input.hasActiveReferral
      ? "priority"
      : input.scope === "personal"
        ? "standard"
        : input.hasRecentViableMatch
          ? "warm"
          : "cold";
  return {
    tier,
    cadenceMinutes: monitoringCadenceMinutes[tier],
    active: tier !== "quarantined",
  };
}

export function isActiveReferralStatus(status: string): boolean {
  return (
    status === "available" ||
    status === "requested" ||
    status === "agreed" ||
    status === "submitted"
  );
}

export function deriveGlobalMonitoringDemand(
  demands: Array<{ tier: MonitoringTier; cadenceMinutes: number }>,
): { tier: MonitoringTier; cadenceMinutes: number } {
  const active = demands.filter((demand) => demand.tier !== "quarantined");
  if (!active.length) return { tier: "cold", cadenceMinutes: monitoringCadenceMinutes.cold };
  const tierOrder: MonitoringTier[] = ["priority", "standard", "warm", "cold"];
  return {
    tier: tierOrder.find((tier) => active.some((demand) => demand.tier === tier))!,
    cadenceMinutes: Math.max(
      monitoringCadenceMinutes.priority,
      Math.min(...active.map((demand) => demand.cadenceMinutes)),
    ),
  };
}

export function isRecentViableRecommendation(input: {
  band: string;
  eligibilityOutcome: string;
  ageHours: number;
}): boolean {
  return (
    input.eligibilityOutcome === "eligible" &&
    (input.band === "hot" || input.band === "strong" || input.band === "possible") &&
    input.ageHours <= 168
  );
}

export function adaptiveColdCadenceMinutes(input: {
  protectedScansPerDay: number;
  coldCompanyCount: number;
  dailyScanBudget?: number;
}): number {
  if (!input.coldCompanyCount) return 240;
  const budget = input.dailyScanBudget ?? 1_000;
  const available = Math.max(1, budget - input.protectedScansPerDay);
  const minutes = (input.coldCompanyCount * 1_440) / available;
  return Math.max(240, Math.ceil(minutes / 15) * 15);
}
