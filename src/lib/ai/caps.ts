export function canEscalateWithinCaps(options: {
  routineCount: number;
  escalationCount: number;
  routineSpendUsd: number;
  escalationSpendUsd: number;
  estimateUsd: number;
}) {
  if (options.routineCount < 1) return false;
  const listingRatio = (options.escalationCount + 1) / options.routineCount;
  const escalationSpend = options.escalationSpendUsd + options.estimateUsd;
  const allSpend = options.routineSpendUsd + escalationSpend;
  return listingRatio <= 0.1 && allSpend > 0 && escalationSpend / allSpend <= 0.2;
}
