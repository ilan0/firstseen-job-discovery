export type SupplyCapacity = {
  prioritySources: number;
  standardSources: number;
  coldSources: number;
  executionsPerScan?: number;
  monthlyExecutionLimit: number;
  usedExecutionsThisMonth: number;
};

export function forecastMonthlyExecutions(capacity: SupplyCapacity) {
  const steps = capacity.executionsPerScan ?? 3;
  const dailyScans =
    capacity.prioritySources * 96 + capacity.standardSources * 24 + capacity.coldSources * 6;
  return dailyScans * steps * 30;
}

export function supplyCapacityState(capacity: SupplyCapacity) {
  const forecast = forecastMonthlyExecutions(capacity);
  const projected = capacity.usedExecutionsThisMonth + forecast;
  const ratio = projected / capacity.monthlyExecutionLimit;
  return {
    forecast,
    projected,
    ratio,
    warning: ratio >= 0.7,
    admitColdSources: ratio < 0.85,
    priorityCadenceProtected: true,
  };
}
