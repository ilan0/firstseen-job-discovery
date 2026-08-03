import { and, eq } from "drizzle-orm";
import { removeWatchCompany } from "./actions";
import { ConfirmSubmit } from "@/components/forms/confirm-submit";
import { WatchlistForm } from "@/components/watchlist/watchlist-form";
import { db } from "@/db/client";
import { careerSources, companies, referrals, watchlists } from "@/db/schema";
import { requireOwner } from "@/lib/auth/owner";

export default async function WatchlistPage() {
  const owner = await requireOwner();
  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      priority: companies.priority,
      notes: companies.notes,
      cadence: watchlists.cadenceMinutes,
      nextScanAt: watchlists.nextScanAt,
      connector: careerSources.connectorKind,
      source: careerSources.baseUrl,
    })
    .from(companies)
    .innerJoin(watchlists, eq(watchlists.companyId, companies.id))
    .leftJoin(
      careerSources,
      and(eq(careerSources.companyId, companies.id), eq(careerSources.active, true)),
    )
    .where(
      and(eq(companies.userId, owner.id), eq(companies.active, true), eq(watchlists.active, true)),
    )
    .orderBy(companies.priority, companies.name);
  const people = await db.select().from(referrals).where(eq(referrals.userId, owner.id));
  const referralsByCompany = new Map<string, string[]>();
  for (const person of people)
    referralsByCompany.set(person.companyId, [
      ...(referralsByCompany.get(person.companyId) ?? []),
      person.personName,
    ]);
  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="text-xs font-black tracking-[0.18em] text-[var(--green)] uppercase">
          Direct monitoring
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-[-0.04em]">Company watchlist</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          Add the official ATS or employer careers page. Priority and referral companies are checked
          most often.
        </p>
      </header>
      <div className="mt-8 grid gap-7 lg:grid-cols-[22rem_1fr]">
        <WatchlistForm />
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-black">Active companies</h2>
            <span className="text-xs font-bold text-[var(--muted)]">{rows.length} monitored</span>
          </div>
          {rows.length ? (
            <div className="space-y-3">
              {rows.map((row) => (
                <article
                  className="rounded-[1.25rem] border border-[var(--line)] bg-[var(--surface)] p-5"
                  key={row.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-black">{row.name}</h3>
                      <p className="mt-1 text-xs font-bold text-[var(--muted)]">
                        Priority {row.priority} · every {row.cadence} minutes ·{" "}
                        {row.connector?.replaceAll("_", " ") ?? "source pending"}
                      </p>
                      {referralsByCompany.get(row.id)?.map((person) => (
                        <p className="mt-2 text-xs font-black text-[#54379a]" key={person}>
                          Referral: {person}
                        </p>
                      ))}
                      {row.notes ? <p className="mt-3 text-sm leading-6">{row.notes}</p> : null}
                    </div>
                    <form action={removeWatchCompany}>
                      <input name="companyId" type="hidden" value={row.id} />
                      <ConfirmSubmit
                        className="rounded-xl border border-[var(--line)] px-3 py-2 text-xs font-black text-[var(--danger)]"
                        message={`Stop monitoring ${row.name}? Existing jobs and history will remain.`}
                        type="submit"
                      >
                        Remove
                      </ConfirmSubmit>
                    </form>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-[1.5rem] border border-dashed border-[var(--line)] bg-[var(--surface)] px-5 py-12 text-center">
              <p className="font-black">No companies yet</p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Your first company takes less than a minute to add.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
