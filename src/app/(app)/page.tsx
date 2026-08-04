import { QueuePage } from "@/components/jobs/queue-page";
import { db } from "@/db/client";
import { applicationSessions, canonicalJobs, companies, searchPreferences } from "@/db/schema";
import { parseFeedSort, parsePostedWindow } from "@/domain/jobs";
import { rolloutFlags } from "@/config/rollout";
import { requireOwner } from "@/lib/auth/owner";
import { listQueue, listQueuePage } from "@/lib/jobs/queue";
import { and, desc, eq, gt } from "drizzle-orm";
import Link from "next/link";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const owner = await requireOwner();
  const params = await searchParams;
  const [preferences] = await db
    .select({
      defaultPostedWindow: searchPreferences.defaultPostedWindow,
      defaultFeedSort: searchPreferences.defaultFeedSort,
    })
    .from(searchPreferences)
    .where(eq(searchPreferences.userId, owner.id))
    .limit(1);
  const single = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const postedWithin = parsePostedWindow(
    single(params.postedWithin),
    parsePostedWindow(preferences?.defaultPostedWindow, "7d"),
  );
  const sort = parseFeedSort(
    single(params.sort),
    parseFeedSort(preferences?.defaultFeedSort, "posted_newest"),
  );
  const bandValue = single(params.band);
  const band =
    bandValue === "hot" ||
    bandValue === "strong" ||
    bandValue === "possible" ||
    bandValue === "review"
      ? bandValue
      : "all";
  const query = single(params.q)?.slice(0, 160) ?? "";
  const referralsOnly = single(params.referrals) === "true";
  const cursor = single(params.cursor)?.slice(0, 800);
  const feedQuery = { postedWithin, sort, band, query, referralsOnly } as const;
  const flags = rolloutFlags();
  const freshnessEnabled = flags.freshnessFeed;
  const [queuePage, olderCandidates] = freshnessEnabled
    ? await Promise.all([
        listQueuePage(owner.id, "active", {
          ...feedQuery,
          ...(cursor ? { cursor } : {}),
        }),
        listQueue(owner.id, "active", {
          ...feedQuery,
          postedWithin: "30d",
        }),
      ])
    : [{ items: await listQueue(owner.id, "active"), nextCursor: null }, []];
  const jobs = queuePage.items;
  const olderExceptional = olderCandidates.filter(
    (job) => job.freshnessSection === "older" && (job.band === "hot" || job.band === "strong"),
  );
  const resumableApplications = flags.applicationWorkflow
    ? await db
        .select({
          sessionId: applicationSessions.id,
          jobId: canonicalJobs.id,
          title: canonicalJobs.title,
          company: companies.name,
          openedAt: applicationSessions.openedAt,
        })
        .from(applicationSessions)
        .innerJoin(
          canonicalJobs,
          and(
            eq(applicationSessions.legacyJobId, canonicalJobs.id),
            eq(canonicalJobs.userId, owner.id),
          ),
        )
        .innerJoin(companies, eq(canonicalJobs.companyId, companies.id))
        .where(
          and(
            eq(applicationSessions.userId, owner.id),
            eq(applicationSessions.disposition, "continue_later"),
            gt(applicationSessions.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(applicationSessions.returnedAt), desc(applicationSessions.openedAt))
        .limit(5)
    : [];
  return (
    <>
      {resumableApplications.length ? (
        <section className="mx-auto mb-6 max-w-5xl rounded-[1.5rem] border border-[#e2c982] bg-[#fff9e8] p-5">
          <p className="text-xs font-black tracking-[0.12em] text-[#76560b] uppercase">
            Continue on desktop
          </p>
          <h2 className="mt-1 text-lg font-black">Applications waiting for you</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {resumableApplications.map((session) => (
              <Link
                className="rounded-xl border border-[#ead9a7] bg-white p-3 transition hover:border-[#b59231]"
                href={`/jobs/${session.jobId}`}
                key={session.sessionId}
              >
                <p className="truncate text-sm font-black">{session.title}</p>
                <p className="mt-1 truncate text-xs text-[var(--muted)]">{session.company}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      <QueuePage
        description="Verified official listings no older than your selected window. Freshness is based on the employer's date—not when an aggregator found it."
        feedQuery={freshnessEnabled ? feedQuery : undefined}
        jobs={jobs}
        nextCursor={queuePage.nextCursor}
        olderJobs={freshnessEnabled && postedWithin === "7d" ? olderExceptional : []}
        status="active"
        title="Fresh matches"
      />
    </>
  );
}
