import type { ConnectorKind } from "@/connectors/versions";

export type Lifecycle = "pending_verification" | "open" | "possibly_closed" | "closed" | "reopened";
export type LifecycleObservation = "seen" | "missing" | "explicit_closed" | "error";

export type LifecycleState = {
  status: Lifecycle;
  consecutiveSuccessfulMisses: number;
  possiblyClosedAt: Date | null;
  closedAt: Date | null;
  reopenedAt: Date | null;
};

const structuredConnectors = new Set<ConnectorKind>([
  "greenhouse",
  "lever",
  "ashby",
  "recruitee",
  "pinpoint",
  "smartrecruiters",
]);

export function transitionLifecycle(
  current: LifecycleState,
  observation: LifecycleObservation,
  connector: ConnectorKind,
  observedAt: Date,
): LifecycleState {
  if (observation === "error") return current;
  if (observation === "seen") {
    const wasClosed = current.status === "closed";
    return {
      status: wasClosed ? "reopened" : "open",
      consecutiveSuccessfulMisses: 0,
      possiblyClosedAt: null,
      closedAt: wasClosed ? current.closedAt : null,
      reopenedAt: wasClosed ? observedAt : current.reopenedAt,
    };
  }
  if (observation === "explicit_closed") {
    return {
      ...current,
      status: "closed",
      consecutiveSuccessfulMisses: current.consecutiveSuccessfulMisses + 1,
      possiblyClosedAt: current.possiblyClosedAt ?? observedAt,
      closedAt: observedAt,
    };
  }

  const misses = current.consecutiveSuccessfulMisses + 1;
  const firstMiss = current.possiblyClosedAt ?? observedAt;
  const elapsedMs = observedAt.getTime() - firstMiss.getTime();
  const structured = structuredConnectors.has(connector);
  const shouldClose = structured
    ? misses >= 2 && elapsedMs >= 3_600_000
    : misses >= 3 && elapsedMs >= 86_400_000;
  return {
    ...current,
    status: shouldClose ? "closed" : "possibly_closed",
    consecutiveSuccessfulMisses: misses,
    possiblyClosedAt: firstMiss,
    closedAt: shouldClose ? observedAt : current.closedAt,
  };
}
