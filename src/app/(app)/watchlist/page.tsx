import { and, eq } from "drizzle-orm";
import { Clock3, ExternalLink, Heart, Radar, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  addCompanyReferral,
  followDiscoveredCompany,
  removeCompanyReferral,
  removeWatchCompany,
  toggleCompanyInterest,
} from "./actions";
import { ConfirmSubmit } from "@/components/forms/confirm-submit";
import { SubmitButton } from "@/components/forms/submit-button";
import { WatchlistForm } from "@/components/watchlist/watchlist-form";
import { db } from "@/db/client";
import { careerSources, companies, referrals, watchlists } from "@/db/schema";
import { rolloutFlags } from "@/config/rollout";
import { requireOwner } from "@/lib/auth/owner";
import { listQueue } from "@/lib/jobs/queue";

type Scope = "my" | "discovered" | "all";

export default async function WatchlistPage({
  searchParams,
}: {
  searchParams: Promise<{ companyScope?: string | string[] }>;
}) {
  const owner = await requireOwner();
  const params = await searchParams;
  const rawScope = Array.isArray(params.companyScope)
    ? params.companyScope[0]
    : params.companyScope;
  const companyScopesEnabled = rolloutFlags().companyScopes;
  const scope: Scope = !companyScopesEnabled
    ? "all"
    : rawScope === "discovered" || rawScope === "all"
      ? rawScope
      : "my";
  const [rows, people, freshMatches] = await Promise.all([
    db
      .select({
        id: companies.id,
        name: companies.name,
        priority: companies.priority,
        notes: companies.notes,
        origin: companies.origin,
        interested: companies.interested,
        provisional: companies.provisional,
        evidence: companies.discoveryEvidence,
        scope: watchlists.scope,
        tier: watchlists.monitoringTier,
        cadence: watchlists.cadenceMinutes,
        nextScanAt: watchlists.nextScanAt,
        connector: careerSources.connectorKind,
        source: careerSources.baseUrl,
        sourceConfidence: careerSources.parsingConfidence,
        lastAttemptAt: careerSources.lastAttemptAt,
        lastSuccessAt: careerSources.lastSuccessAt,
        lastErrorCode: careerSources.lastErrorCode,
      })
      .from(companies)
      .innerJoin(
        watchlists,
        and(eq(watchlists.companyId, companies.id), eq(watchlists.userId, owner.id)),
      )
      .leftJoin(
        careerSources,
        and(
          eq(careerSources.companyId, companies.id),
          eq(careerSources.userId, owner.id),
          eq(careerSources.active, true),
        ),
      )
      .where(
        and(
          eq(companies.userId, owner.id),
          eq(companies.active, true),
          eq(watchlists.active, true),
        ),
      )
      .orderBy(companies.priority, companies.name),
    db.select().from(referrals).where(eq(referrals.userId, owner.id)),
    listQueue(owner.id, "active", { postedWithin: "7d" }),
  ]);
  const referralsByCompany = new Map<string, typeof people>();
  for (const person of people)
    referralsByCompany.set(person.companyId, [
      ...(referralsByCompany.get(person.companyId) ?? []),
      person,
    ]);
  const matchesByCompany = new Map<string, typeof freshMatches>();
  for (const job of freshMatches)
    matchesByCompany.set(job.companyId, [...(matchesByCompany.get(job.companyId) ?? []), job]);
  const mine = rows.filter((row) => row.scope === "personal");
  const discovered = rows.filter((row) => row.scope === "discovered");
  const visible = scope === "my" ? mine : scope === "discovered" ? discovered : rows;

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="text-xs font-black tracking-[0.18em] text-[var(--green)] uppercase">
          Official-source monitoring
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-[-0.04em]">Companies</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
          My Companies contains only companies you intentionally follow. Automatic discoveries stay
          separate, with their provenance and scan health visible.
        </p>
      </header>
      {companyScopesEnabled ? (
        <nav aria-label="Company scope" className="mt-7 flex flex-wrap gap-2">
          <ScopeLink active={scope === "my"} count={mine.length} href="/watchlist?companyScope=my">
            My companies
          </ScopeLink>
          <ScopeLink
            active={scope === "discovered"}
            count={discovered.length}
            href="/watchlist?companyScope=discovered"
          >
            Discovered companies
          </ScopeLink>
          <ScopeLink
            active={scope === "all"}
            count={rows.length}
            href="/watchlist?companyScope=all"
          >
            All monitored
          </ScopeLink>
        </nav>
      ) : null}
      <div className="mt-8 grid gap-7 lg:grid-cols-[22rem_1fr]">
        <div>
          <WatchlistForm />
          <aside className="mt-4 rounded-2xl bg-[var(--surface)] p-4 text-xs leading-5 text-[var(--muted)]">
            <strong className="text-[var(--ink)]">How priority works:</strong> Interested companies
            and companies with an active referral scan every 15 minutes. Other followed companies
            scan hourly.
          </aside>
        </div>
        <section aria-live="polite">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-black">
              {scope === "my"
                ? "My companies"
                : scope === "discovered"
                  ? "Automatically discovered"
                  : "All monitored companies"}
            </h2>
            <span className="text-xs font-bold text-[var(--muted)]">{visible.length} shown</span>
          </div>
          {visible.length ? (
            <div className="space-y-3">
              {visible.map((row) => (
                <CompanyCard
                  freshMatches={matchesByCompany.get(row.id) ?? []}
                  key={row.id}
                  referrals={referralsByCompany.get(row.id) ?? []}
                  row={row}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-[1.5rem] border border-dashed border-[var(--line)] bg-[var(--surface)] px-5 py-12 text-center">
              <p className="font-black">
                {scope === "my" ? "No personally followed companies yet" : "No discoveries yet"}
              </p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {scope === "my"
                  ? "Add a company on the left or follow one from Discovered Companies."
                  : "Broad discovery runs every four hours and verifies every candidate on an official ATS."}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ScopeLink({
  active,
  count,
  href,
  children,
}: {
  active: boolean;
  count: number;
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`rounded-xl px-4 py-2.5 text-sm font-black ${active ? "bg-[var(--green)] text-white" : "border border-[var(--line)] bg-[var(--surface)]"}`}
      href={href}
    >
      {children} <span className="ml-1 opacity-70">{count}</span>
    </Link>
  );
}

function CompanyCard({
  row,
  referrals: companyReferrals,
  freshMatches,
}: {
  row: {
    id: string;
    name: string;
    priority: number;
    notes: string | null;
    origin: "manual" | "referral" | "discovered";
    interested: boolean;
    provisional: boolean;
    evidence: unknown;
    scope: "personal" | "discovered";
    tier: "priority" | "standard" | "warm" | "cold" | "quarantined";
    cadence: number;
    nextScanAt: Date;
    connector: string | null;
    source: string | null;
    sourceConfidence: number | null;
    lastAttemptAt: Date | null;
    lastSuccessAt: Date | null;
    lastErrorCode: string | null;
  };
  referrals: Array<{ id: string; personName: string; status: string }>;
  freshMatches: Array<{ jobId: string; title: string; band: string | null }>;
}) {
  const evidence = row.evidence as {
    sensor?: string;
    discoveredAt?: string;
  } | null;
  const discovered = row.scope === "discovered";
  const automaticOrigin = row.origin === "discovered";
  return (
    <article className="rounded-[1.25rem] border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-black">{row.name}</h3>
            {automaticOrigin ? <Chip label="Automatic" tone="blue" /> : null}
            {!discovered ? <Chip label="Followed" /> : null}
            {row.interested ? <Chip label="Interested" tone="pink" /> : null}
            {companyReferrals.length ? <Chip label="Referral" tone="purple" /> : null}
            <Chip label={row.tier} />
          </div>
          <p className="mt-2 text-xs font-bold text-[var(--muted)]">
            Every {row.cadence} minutes · {row.connector?.replaceAll("_", " ") ?? "source pending"}
            {row.sourceConfidence ? ` · ${row.sourceConfidence}% source confidence` : ""}
          </p>
          {automaticOrigin ? (
            <p className="mt-3 rounded-xl bg-[var(--paper)] p-3 text-xs leading-5 text-[var(--muted)]">
              <Radar aria-hidden="true" className="mr-1 inline text-[var(--green)]" size={14} />
              Found by {evidence?.sensor ?? "broad discovery"}
              {evidence?.discoveredAt
                ? ` on ${new Date(evidence.discoveredAt).toLocaleDateString()}`
                : ""}
              .{" "}
              {row.provisional ? "Official source is still provisional." : "Official ATS verified."}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[var(--muted)]">
            <span className="inline-flex items-center gap-1.5">
              <Clock3 aria-hidden="true" size={14} /> Next scan {row.nextScanAt.toLocaleString()}
            </span>
            <span>
              Last success {row.lastSuccessAt?.toLocaleString() ?? "not yet"}
              {row.lastErrorCode ? ` · issue: ${row.lastErrorCode}` : ""}
            </span>
          </div>
          {row.source ? (
            <a
              className="mt-2 flex w-fit max-w-full items-center gap-1.5 truncate text-xs font-black text-[var(--green)] hover:underline"
              href={row.source}
              rel="noreferrer"
              target="_blank"
            >
              Official source <ExternalLink aria-hidden="true" size={13} />
            </a>
          ) : null}
          {freshMatches.length ? (
            <div className="mt-4">
              <p className="text-xs font-black">Fresh viable matches ({freshMatches.length})</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {freshMatches.slice(0, 3).map((job) => (
                  <Link
                    className="rounded-lg bg-[var(--paper)] px-2 py-1 text-xs font-bold hover:text-[var(--green)]"
                    href={`/jobs/${job.jobId}`}
                    key={job.jobId}
                  >
                    {job.title} · {job.band}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
          {row.notes ? <p className="mt-3 text-sm leading-6">{row.notes}</p> : null}
          <div className="mt-4 space-y-2">
            {companyReferrals.map((person) => (
              <div className="flex flex-wrap items-center gap-2 text-xs" key={person.id}>
                <span className="font-black text-[#54379a]">
                  Referral: {person.personName} · {person.status}
                </span>
                <form action={removeCompanyReferral}>
                  <input name="referralId" type="hidden" value={person.id} />
                  <SubmitButton
                    className="font-black text-[var(--danger)]"
                    pendingLabel="Removing…"
                  >
                    Remove
                  </SubmitButton>
                </form>
              </div>
            ))}
            <form action={addCompanyReferral} className="flex max-w-md gap-2">
              <input name="companyId" type="hidden" value={row.id} />
              <label className="sr-only" htmlFor={`referral-${row.id}`}>
                Referral person for {row.name}
              </label>
              <input
                className="min-h-10 min-w-0 flex-1 rounded-xl bg-[var(--paper)] px-3 text-xs"
                id={`referral-${row.id}`}
                name="personName"
                placeholder="Add referral person"
                required
              />
              <SubmitButton
                className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-[var(--line)] px-3 text-xs font-black"
                pendingLabel="Adding…"
              >
                <UserRoundPlus aria-hidden="true" size={14} /> Add
              </SubmitButton>
            </form>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {discovered ? (
            <>
              <form action={followDiscoveredCompany}>
                <input name="companyId" type="hidden" value={row.id} />
                <SubmitButton
                  className="min-h-10 rounded-xl bg-[var(--green)] px-3 text-xs font-black text-white"
                  pendingLabel="Following…"
                >
                  Follow
                </SubmitButton>
              </form>
              <form action={toggleCompanyInterest}>
                <input name="companyId" type="hidden" value={row.id} />
                <input name="interested" type="hidden" value={row.interested ? "false" : "true"} />
                <SubmitButton
                  className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-[var(--line)] px-3 text-xs font-black"
                  pendingLabel="Saving…"
                >
                  <Heart
                    aria-hidden="true"
                    fill={row.interested ? "currentColor" : "none"}
                    size={14}
                  />
                  {row.interested ? "Interested" : "Mark interested"}
                </SubmitButton>
              </form>
              <form action={removeWatchCompany}>
                <input name="companyId" type="hidden" value={row.id} />
                <ConfirmSubmit
                  className="min-h-10 rounded-xl border border-[var(--line)] px-3 text-xs font-black text-[var(--danger)]"
                  message={`Mark ${row.name} not relevant? Automatic discovery will not reactivate it.`}
                  type="submit"
                >
                  Not relevant
                </ConfirmSubmit>
              </form>
            </>
          ) : (
            <>
              <form action={toggleCompanyInterest}>
                <input name="companyId" type="hidden" value={row.id} />
                <input name="interested" type="hidden" value={row.interested ? "false" : "true"} />
                <SubmitButton
                  className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-[var(--line)] px-3 text-xs font-black"
                  pendingLabel="Saving…"
                >
                  <Heart
                    aria-hidden="true"
                    fill={row.interested ? "currentColor" : "none"}
                    size={14}
                  />
                  {row.interested ? "Interested" : "Mark interested"}
                </SubmitButton>
              </form>
              <form action={removeWatchCompany}>
                <input name="companyId" type="hidden" value={row.id} />
                <ConfirmSubmit
                  className="min-h-10 rounded-xl border border-[var(--line)] px-3 text-xs font-black text-[var(--danger)]"
                  message={`Stop monitoring ${row.name}? Existing jobs and history will remain.`}
                  type="submit"
                >
                  Stop monitoring
                </ConfirmSubmit>
              </form>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function Chip({ label, tone }: { label: string; tone?: "blue" | "pink" | "purple" }) {
  const color =
    tone === "blue"
      ? "bg-[#dff3ff] text-[#215f7a]"
      : tone === "pink"
        ? "bg-[#ffe2e9] text-[#8d3450]"
        : tone === "purple"
          ? "bg-[#e8e0ff] text-[#54379a]"
          : "bg-[var(--paper)] text-[var(--muted)]";
  return (
    <span className={`rounded-full px-2.5 py-1 text-[0.65rem] font-black uppercase ${color}`}>
      {label}
    </span>
  );
}
