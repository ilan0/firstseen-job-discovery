import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Activity, CircleCheck, CircleX, Clock3, RefreshCw } from "lucide-react";
import { replayDeadLetter, requestSourceScan } from "./actions";
import { db } from "@/db/client";
import {
  careerSources,
  companies,
  deadLetterRecords,
  scanRuns,
  usageCostLedger,
} from "@/db/schema";
import { requireOwner } from "@/lib/auth/owner";

export default async function OperationsPage() {
  const owner = await requireOwner();
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
    })
    .from(careerSources)
    .innerJoin(companies, eq(careerSources.companyId, companies.id))
    .where(and(eq(careerSources.userId, owner.id), eq(careerSources.active, true)))
    .orderBy(companies.name);
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
  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="text-xs font-black tracking-[0.18em] text-[var(--green)] uppercase">
          Operational diagnostics
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-[-0.04em]">Scan health</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Provider failures stay isolated. Safe error codes and source freshness are visible here.
        </p>
      </header>
      <div className="mt-7 grid gap-4 sm:grid-cols-3">
        <Stat icon={Activity} label="Active sources" value={String(sources.length)} />
        <Stat icon={CircleX} label="Unresolved dead letters" value={String(dead?.count ?? 0)} />
        <Stat
          icon={Clock3}
          label="Estimated cost this month"
          value={`$${Number(cost?.usd ?? 0).toFixed(2)}`}
        />
      </div>
      <section className="mt-8">
        <h2 className="text-lg font-black">Sources</h2>
        {sources.length ? (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
            <table className="w-full min-w-[45rem] text-left text-sm">
              <thead className="border-b border-[var(--line)] text-xs uppercase">
                <tr>
                  <th className="p-4">Company</th>
                  <th className="p-4">Connector</th>
                  <th className="p-4">Last success</th>
                  <th className="p-4">State</th>
                  <th className="p-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr className="border-b border-[var(--line)] last:border-0" key={source.id}>
                    <td className="p-4 font-black">{source.company}</td>
                    <td className="p-4">{source.connector}</td>
                    <td className="p-4 text-[var(--muted)]">
                      {source.lastSuccessAt?.toLocaleString() ?? "Never"}
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
                        <button
                          className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--line)] px-3 py-2 text-xs font-black"
                          type="submit"
                        >
                          <RefreshCw size={14} /> Scan now
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                  <button
                    className="rounded-xl border border-[var(--line)] px-3 py-2 text-xs font-black"
                    type="submit"
                  >
                    Replay safely
                  </button>
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
          <p className="mt-3 text-sm text-[var(--muted)]">No scheduled runs have completed yet.</p>
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
