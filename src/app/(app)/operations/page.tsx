import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Activity, CircleCheck, CircleX, Clock3, Radar, RefreshCw } from "lucide-react";
import { replayDeadLetter, requestBroadDiscovery, requestSourceScan } from "./actions";
import { SubmitButton } from "@/components/forms/submit-button";
import { db } from "@/db/client";
import {
  careerSources,
  canonicalJobs,
  companies,
  deadLetterRecords,
  scanRuns,
  usageCostLedger,
  watchlists,
} from "@/db/schema";
import { requireOwner } from "@/lib/auth/owner";

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ started?: string }>;
}) {
  const owner = await requireOwner();
  const checkedAt = new Date();
  const query = await searchParams;
  const successMessage =
    query.started === "scan"
      ? "Official-source scan queued."
      : query.started === "discovery"
        ? "Broad discovery queued. Official sources will be verified before jobs appear."
        : query.started === "replay"
          ? "Recovery scan queued."
          : null;
  const runs = await db
    .select()
    .from(scanRuns)
    .where(eq(scanRuns.userId, owner.id))
    .orderBy(desc(scanRuns.scheduledFor))
    .limit(20);
  const sources = await db
    .select({
      id: careerSources.id,
      company: companies.name,
      connector: careerSources.connectorKind,
      lastAttemptAt: careerSources.lastAttemptAt,
      lastSuccessAt: careerSources.lastSuccessAt,
      lastError: careerSources.lastErrorCode,
      tier: watchlists.monitoringTier,
      scope: watchlists.scope,
      cadence: watchlists.cadenceMinutes,
      nextScanAt: watchlists.nextScanAt,
    })
    .from(careerSources)
    .innerJoin(companies, eq(careerSources.companyId, companies.id))
    .innerJoin(
      watchlists,
      and(eq(watchlists.companyId, companies.id), eq(watchlists.userId, owner.id)),
    )
    .where(and(eq(careerSources.userId, owner.id), eq(careerSources.active, true)))
    .orderBy(companies.name);
  const jobs = await db
    .select({
      postedAt: canonicalJobs.postedAt,
      postedAtConfidence: canonicalJobs.postedAtConfidence,
      firstSeenAt: canonicalJobs.firstSeenAt,
      verifiedAt: canonicalJobs.verifiedAt,
      lifecycleStatus: canonicalJobs.lifecycleStatus,
    })
    .from(canonicalJobs)
    .where(eq(canonicalJobs.userId, owner.id));
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [cost] = await db
    .select({
      usd: sql<string>`coalesce(sum(coalesce(${usageCostLedger.actualCostUsd}, ${usageCostLedger.estimatedCostUsd})), 0)`,
    })
    .from(usageCostLedger)
    .where(and(eq(usageCostLedger.userId, owner.id), gte(usageCostLedger.occurredAt, monthStart)));
  const [dead] = await db
    .select({ count: sql<number>`count(*)` })
    .from(deadLetterRecords)
    .where(
      and(eq(deadLetterRecords.userId, owner.id), sql`${deadLetterRecords.resolvedAt} is null`),
    );
  const deadLetters = await db
    .select()
    .from(deadLetterRecords)
    .where(
      and(eq(deadLetterRecords.userId, owner.id), sql`${deadLetterRecords.resolvedAt} is null`),
    )
    .orderBy(desc(deadLetterRecords.failedAt))
    .limit(10);
  const reliablePosted = jobs.filter((job) => job.postedAt && job.postedAtConfidence !== "low");
  const detectionLatencies = reliablePosted
    .map((job) => Math.max(0, job.firstSeenAt.getTime() - job.postedAt!.getTime()) / 3_600_000)
    .toSorted((a, b) => a - b);
  const medianDetectionLatency = detectionLatencies.length
    ? (detectionLatencies[Math.floor(detectionLatencies.length / 2)] ?? null)
    : null;
  const scheduledScansPerDay = sources.reduce((sum, source) => sum + 1_440 / source.cadence, 0);
  const stalePrioritySources = sources.filter(
    (source) =>
      source.tier === "priority" &&
      (!source.lastSuccessAt ||
        source.lastSuccessAt.getTime() <
          checkedAt.getTime() - Math.max(60, source.cadence * 3) * 60_000),
  );
  const activeSourceErrors = sources.filter((source) => source.lastError).length;
  const adaptedColdSources = sources.filter(
    (source) => source.tier === "cold" && source.cadence > 240,
  ).length;
  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-xs font-black tracking-[0.18em] text-[var(--green)] uppercase">
            Operational diagnostics
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-[-0.04em]">Scan health</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Provider failures stay isolated. Safe error codes and source freshness are visible here.
          </p>
        </div>
        <form action={requestBroadDiscovery}>
          <SubmitButton
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--green)] px-4 text-sm font-black text-white transition hover:bg-[var(--green-dark)]"
            pendingLabel="Starting discovery…"
            type="submit"
          >
            <Radar aria-hidden="true" size={17} /> Discover jobs now
          </SubmitButton>
        </form>
      </header>
      {successMessage ? (
        <p
          className="mt-5 rounded-xl border border-[var(--green)] bg-[var(--surface)] p-3 text-sm font-bold text-[var(--green)]"
          role="status"
        >
          {successMessage}
        </p>
      ) : null}
      {stalePrioritySources.length || activeSourceErrors || adaptedColdSources ? (
        <div
          className="mt-6 rounded-2xl border border-[var(--coral)] bg-[#fff5ed] p-4 text-sm"
          role="alert"
        >
          <p className="font-black">Monitoring attention required</p>
          <p className="mt-1 text-[var(--muted)]">
            {stalePrioritySources.length} stale priority source
            {stalePrioritySources.length === 1 ? "" : "s"} · {activeSourceErrors} active source
            error{activeSourceErrors === 1 ? "" : "s"} · {adaptedColdSources} quota-adapted cold
            source{adaptedColdSources === 1 ? "" : "s"}. Priority cadence has not been reduced.
          </p>
        </div>
      ) : null}
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat icon={Activity} label="Active sources" value={String(sources.length)} />
        <Stat icon={CircleX} label="Unresolved dead letters" value={String(dead?.count ?? 0)} />
        <Stat
          icon={Clock3}
          label="Estimated cost this month"
          value={`$${Number(cost?.usd ?? 0).toFixed(2)}`}
        />
        <Stat
          icon={Radar}
          label="Scheduled official scans/day"
          value={scheduledScansPerDay.toFixed(0)}
        />
        <Stat
          icon={Clock3}
          label="Median posted-to-detected latency"
          value={
            medianDetectionLatency === null ? "No data" : `${medianDetectionLatency.toFixed(1)}h`
          }
        />
        <Stat
          icon={CircleCheck}
          label="Reliable official timestamps"
          value={`${reliablePosted.length}/${jobs.length}`}
        />
      </div>
      <section className="mt-8">
        <h2 className="text-lg font-black">Sources</h2>
        {sources.length ? (
          <>
            <div className="mt-3 space-y-3 sm:hidden">
              {sources.map((source) => (
                <article
                  className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4"
                  key={source.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-black">{source.company}</h3>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {source.connector.replaceAll("_", " ")} · {source.scope} · {source.tier} ·
                        every {source.cadence}m
                      </p>
                    </div>
                    {source.lastError ? (
                      <span className="text-xs font-bold text-[var(--danger)]">
                        {source.lastError}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--green)]">
                        <CircleCheck aria-hidden="true" size={14} /> Ready
                      </span>
                    )}
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="font-black">Last success</dt>
                      <dd className="mt-1 text-[var(--muted)]">
                        {source.lastSuccessAt?.toLocaleString() ?? "Never"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-black">Last attempt</dt>
                      <dd className="mt-1 text-[var(--muted)]">
                        {source.lastAttemptAt?.toLocaleString() ?? "Never"}
                      </dd>
                    </div>
                  </dl>
                  <form action={requestSourceScan} className="mt-4">
                    <input name="sourceId" type="hidden" value={source.id} />
                    <SubmitButton
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[var(--line)] px-3 text-xs font-black"
                      pendingLabel="Starting…"
                      type="submit"
                    >
                      <RefreshCw aria-hidden="true" size={14} /> Scan now
                    </SubmitButton>
                  </form>
                </article>
              ))}
            </div>
            <div className="mt-3 hidden overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] sm:block">
              <table className="w-full min-w-[45rem] text-left text-sm">
                <thead className="border-b border-[var(--line)] text-xs uppercase">
                  <tr>
                    <th className="p-4">Company</th>
                    <th className="p-4">Connector</th>
                    <th className="p-4">Tier</th>
                    <th className="p-4">Last success</th>
                    <th className="p-4">Last attempt</th>
                    <th className="p-4">State</th>
                    <th className="p-4">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((source) => (
                    <tr className="border-b border-[var(--line)] last:border-0" key={source.id}>
                      <td className="p-4 font-black">{source.company}</td>
                      <td className="p-4">{source.connector}</td>
                      <td className="p-4">
                        {source.scope} · {source.tier} · {source.cadence}m
                      </td>
                      <td className="p-4 text-[var(--muted)]">
                        {source.lastSuccessAt?.toLocaleString() ?? "Never"}
                      </td>
                      <td className="p-4 text-[var(--muted)]">
                        {source.lastAttemptAt?.toLocaleString() ?? "Never"}
                      </td>
                      <td className="p-4">
                        {source.lastError ? (
                          <span className="text-[var(--danger)]">{source.lastError}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[var(--green)]">
                            <CircleCheck size={15} /> Ready
                          </span>
                        )}
                      </td>
                      <td className="p-4">
                        <form action={requestSourceScan}>
                          <input name="sourceId" type="hidden" value={source.id} />
                          <SubmitButton
                            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--line)] px-3 py-2 text-xs font-black"
                            pendingLabel="Starting…"
                            type="submit"
                          >
                            <RefreshCw size={14} /> Scan now
                          </SubmitButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="mt-3 rounded-2xl border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--muted)]">
            Add a company to see source diagnostics.
          </p>
        )}
      </section>
      {deadLetters.length ? (
        <section className="mt-8">
          <h2 className="text-lg font-black">Recovery queue</h2>
          <div className="mt-3 space-y-2">
            {deadLetters.map((record) => (
              <article
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4"
                key={record.id}
              >
                <div>
                  <p className="text-sm font-black">
                    {record.workflowName} · {record.errorCode}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Failed {record.failedAt.toLocaleString()} · {record.errorMessageSafe}
                  </p>
                </div>
                <form action={replayDeadLetter}>
                  <input name="deadLetterId" type="hidden" value={record.id} />
                  <SubmitButton
                    className="rounded-xl border border-[var(--line)] px-3 py-2 text-xs font-black"
                    pendingLabel="Replaying…"
                    type="submit"
                  >
                    Replay safely
                  </SubmitButton>
                </form>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <section className="mt-8">
        <h2 className="text-lg font-black">Recent runs</h2>
        {runs.length ? (
          <div className="mt-3 space-y-2">
            {runs.map((run) => (
              <article
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4"
                key={run.id}
              >
                <div>
                  <p className="text-sm font-black">
                    {run.kind.replaceAll("_", " ")} · {run.status}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {run.scheduledFor.toLocaleString()} · {run.discoveredCount} observed ·{" "}
                    {run.failureCount} failures
                  </p>
                </div>
                <span className="rounded-full bg-[var(--paper)] px-3 py-1 text-xs font-bold">
                  {run.trigger}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">No scan runs have started yet.</p>
        )}
      </section>
    </div>
  );
}
function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.25rem] border border-[var(--line)] bg-[var(--surface)] p-5">
      <Icon className="text-[var(--green)]" size={21} />
      <p className="mt-4 text-2xl font-black">{value}</p>
      <p className="mt-1 text-xs font-bold text-[var(--muted)]">{label}</p>
    </div>
  );
}
