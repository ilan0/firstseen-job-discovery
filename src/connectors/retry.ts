import { ConnectorError } from "./errors";

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maximumDelayMs?: number;
  random?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
};

const defaultWait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function withConnectorRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maximumDelayMs = options.maximumDelayMs ?? 8_000;
  const random = options.random ?? Math.random;
  const wait = options.wait ?? defaultWait;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retryable = !(error instanceof ConnectorError) || error.retryable;
      if (!retryable || attempt === attempts) throw error;
      const exponential = Math.min(maximumDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await wait(Math.round(exponential * (0.75 + random() * 0.5)));
    }
  }
  throw new ConnectorError("RETRY_EXHAUSTED", "The source exhausted its retries.", false);
}
