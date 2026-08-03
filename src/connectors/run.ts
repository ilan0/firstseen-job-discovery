import { performance } from "node:perf_hooks";
import type { ConnectorSource, JobConnector, SourceRunResult } from "./types";
import { safeConnectorError } from "./errors";

export async function runSourcesIsolated(
  sources: ConnectorSource[],
  connectorFor: (source: ConnectorSource) => JobConnector,
  concurrency = 5,
): Promise<SourceRunResult[]> {
  const results: SourceRunResult[] = new Array(sources.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < sources.length) {
      const index = nextIndex;
      nextIndex += 1;
      const source = sources[index]!;
      const started = performance.now();
      try {
        const page = await connectorFor(source).discover(source);
        results[index] = {
          ok: true,
          sourceId: source.id,
          page,
          durationMs: Math.round(performance.now() - started),
        };
      } catch (error) {
        results[index] = {
          ok: false,
          sourceId: source.id,
          ...safeConnectorError(error),
          durationMs: Math.round(performance.now() - started),
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), sources.length) }, () => worker()),
  );
  return results;
}
