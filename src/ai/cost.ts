export type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

type Price = { input: number; cachedInput: number; output: number };

// USD per one million tokens. Keep this map versioned and verify against the provider before release.
const MODEL_PRICES: Record<string, Price> = {
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.6-sol": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-5.6": { input: 5, cachedInput: 0.5, output: 30 },
};

export function estimateOpenAICost(model: string, usage: TokenUsage): number {
  const price = MODEL_PRICES[model];
  if (!price) throw new Error(`OpenAI price is not configured for model ${model}`);
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return (
    uncachedInput * (price.input / 1_000_000) +
    usage.cachedInputTokens * (price.cachedInput / 1_000_000) +
    usage.outputTokens * (price.output / 1_000_000)
  );
}

export function canReserveBudget(options: {
  spentUsd: number;
  reservedUsd: number;
  estimateUsd: number;
  monthlyLimitUsd: number;
}): boolean {
  return options.spentUsd + options.reservedUsd + options.estimateUsd <= options.monthlyLimitUsd;
}
