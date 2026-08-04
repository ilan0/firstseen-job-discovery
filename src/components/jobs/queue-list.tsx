"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { FeedQuery, QueueStatus, listQueue } from "@/lib/jobs/queue";
import { JobCard } from "./job-card";

type Jobs = Awaited<ReturnType<typeof listQueue>>;
type FeedSection = "just_posted" | "new" | "recent" | "older" | "stale";

const sectionCopy: Record<FeedSection, { title: string; description: string }> = {
  just_posted: { title: "Just posted", description: "Officially posted in the last 24 hours" },
  new: { title: "New", description: "Officially posted one to three days ago" },
  recent: { title: "Recent", description: "Officially posted three to seven days ago" },
  older: { title: "Older listings", description: "Verified listings more than seven days old" },
  stale: { title: "Archive", description: "Listings more than 30 days old" },
};

export function QueueList({
  jobs,
  olderJobs = [],
  status,
  feedQuery,
}: {
  jobs: Jobs;
  olderJobs?: Jobs | undefined;
  status: QueueStatus;
  feedQuery?: FeedQuery | undefined;
}) {
  const activeFeed = status === "active" && Boolean(feedQuery);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(feedQuery?.query ?? "");
  const [band, setBand] = useState(feedQuery?.band ?? "all");
  const [referralsOnly, setReferralsOnly] = useState(feedQuery?.referralsOnly ?? false);
  const [sort, setSort] = useState(feedQuery?.sort ?? (activeFeed ? "posted_newest" : "urgency"));
  const [postedWithin, setPostedWithin] = useState(feedQuery?.postedWithin ?? "7d");
  const firstQueryRender = useRef(true);
  const navigationParams = useRef<URLSearchParams | null>(null);

  function updateUrl(values: Record<string, string | null>) {
    if (!activeFeed) return;
    const params = navigationParams.current ?? new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(values)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    navigationParams.current = params;
    startTransition(() => router.replace(`/?${params.toString()}`, { scroll: false }));
  }

  useEffect(() => {
    if (!activeFeed || firstQueryRender.current) {
      firstQueryRender.current = false;
      return;
    }
    const timeout = window.setTimeout(() => updateUrl({ q: query || null }), 250);
    return () => window.clearTimeout(timeout);
    // updateUrl deliberately uses the latest browser URL at execution time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFeed, query]);

  useEffect(() => {
    if (!pending) navigationParams.current = null;
  }, [pending]);

  const displayed = useMemo(() => {
    if (activeFeed) return jobs;
    return jobs
      .filter((job) => `${job.title} ${job.company}`.toLowerCase().includes(query.toLowerCase()))
      .filter((job) => band === "all" || job.band === band)
      .filter((job) => !referralsOnly || job.hasReferral)
      .toSorted((a, b) =>
        sort === "detected_newest"
          ? b.firstSeenAt.getTime() - a.firstSeenAt.getTime()
          : (b.urgency ?? -1) - (a.urgency ?? -1),
      );
  }, [activeFeed, band, jobs, query, referralsOnly, sort]);

  const groups = useMemo(() => {
    const result = new Map<FeedSection, Jobs>();
    for (const job of displayed) {
      const section = job.freshnessSection;
      result.set(section, [...(result.get(section) ?? []), job]);
    }
    return result;
  }, [displayed]);

  function reset() {
    setQuery("");
    setBand("all");
    setReferralsOnly(false);
    setSort(activeFeed ? "posted_newest" : "urgency");
    setPostedWithin("7d");
    if (activeFeed) {
      navigationParams.current = new URLSearchParams();
      startTransition(() => router.replace("/", { scroll: false }));
    }
  }

  const hasFilters =
    Boolean(query) ||
    band !== "all" ||
    referralsOnly ||
    sort !== (activeFeed ? "posted_newest" : "urgency") ||
    (activeFeed && postedWithin !== "7d");

  return (
    <>
      <div
        aria-busy={pending}
        className="mb-5 grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 sm:grid-cols-2 xl:grid-cols-[1fr_auto_auto_auto_auto]"
      >
        <label className="relative">
          <span className="sr-only">Search jobs</span>
          <Search className="absolute top-3 left-3 text-[var(--muted)]" size={17} />
          <input
            className="min-h-10 w-full rounded-xl bg-[var(--paper)] pr-3 pl-10 text-sm"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title or company"
            value={query}
          />
        </label>
        {activeFeed ? (
          <select
            aria-label="Posted within"
            className="min-h-10 rounded-xl bg-[var(--paper)] px-3 text-xs font-black"
            onChange={(event) => {
              setPostedWithin(event.target.value as typeof postedWithin);
              updateUrl({ postedWithin: event.target.value });
            }}
            value={postedWithin}
          >
            <option value="6h">Posted in the last 6 hours</option>
            <option value="24h">Posted in the last 24 hours</option>
            <option value="3d">Posted in the last 3 days</option>
            <option value="7d">Posted in the last 7 days</option>
            <option value="30d">Posted in the last 30 days</option>
            <option value="all">All listings</option>
          </select>
        ) : null}
        <select
          aria-label="Filter match type"
          className="min-h-10 rounded-xl bg-[var(--paper)] px-3 text-xs font-black"
          onChange={(event) => {
            setBand(event.target.value as typeof band);
            updateUrl({ band: event.target.value === "all" ? null : event.target.value });
          }}
          value={band}
        >
          <option value="all">All match types</option>
          <option value="hot">Hot matches</option>
          <option value="strong">Strong</option>
          <option value="possible">Possible</option>
          <option value="review">Review</option>
        </select>
        <label className="flex min-h-10 items-center gap-2 rounded-xl bg-[var(--paper)] px-3 text-xs font-black">
          <input
            checked={referralsOnly}
            onChange={(event) => {
              setReferralsOnly(event.target.checked);
              updateUrl({ referrals: event.target.checked ? "true" : null });
            }}
            type="checkbox"
          />
          Referrals
        </label>
        <select
          aria-label="Sort jobs"
          className="min-h-10 rounded-xl bg-[var(--paper)] px-3 text-xs font-black"
          onChange={(event) => {
            setSort(event.target.value as typeof sort);
            updateUrl({ sort: event.target.value });
          }}
          value={sort}
        >
          {activeFeed ? <option value="posted_newest">Official date: newest</option> : null}
          <option value="detected_newest">FirstSeen detection</option>
          <option value="urgency">Most urgent</option>
        </select>
      </div>
      <div className="mb-4 flex min-h-8 flex-wrap items-center justify-between gap-3 text-xs font-bold text-[var(--muted)]">
        <p aria-live="polite">
          {pending ? "Updating verified listings…" : `Showing ${displayed.length} jobs`}
        </p>
        {hasFilters ? (
          <button
            className="rounded-lg px-2 py-1 font-black text-[var(--green)] hover:bg-[var(--surface)]"
            onClick={reset}
            type="button"
          >
            Reset filters
          </button>
        ) : null}
      </div>
      {displayed.length ? (
        activeFeed ? (
          <div className="space-y-9">
            {(["just_posted", "new", "recent", "older", "stale"] as const).map((section) => {
              const sectionJobs = groups.get(section) ?? [];
              if (!sectionJobs.length) return null;
              return <JobSection jobs={sectionJobs} key={section} section={section} />;
            })}
          </div>
        ) : (
          <div className="space-y-4">
            {displayed.map((job) => (
              <JobCard job={job} key={job.jobId} />
            ))}
          </div>
        )
      ) : (
        <section className="rounded-[2rem] border border-dashed border-[var(--line)] bg-[var(--surface)] px-6 py-14 text-center">
          <h2 className="text-xl font-black">
            {status === "active" ? "No fresh verified matches" : "Nothing here yet"}
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">
            {status === "active"
              ? "FirstSeen is still monitoring official sources. Expand the posted-date window or reset filters to review more listings."
              : "Jobs move here immediately when you take that action."}
          </p>
          {status === "active" ? (
            <button
              className="mt-5 min-h-11 rounded-xl bg-[var(--green)] px-5 text-sm font-black text-white"
              onClick={reset}
              type="button"
            >
              Show the default fresh feed
            </button>
          ) : null}
        </section>
      )}
      {activeFeed && olderJobs.length ? (
        <section className="mt-10 border-t border-[var(--line)] pt-8">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">Older exceptional matches</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Strong fits posted 7–30 days ago, separated from your daily workflow.
              </p>
            </div>
            <Link className="text-xs font-black text-[var(--green)]" href="/?postedWithin=30d">
              Review all last-30-day listings
            </Link>
          </div>
          <div className="space-y-4">
            {olderJobs.map((job) => (
              <JobCard job={job} key={job.jobId} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function JobSection({ jobs, section }: { jobs: Jobs; section: FeedSection }) {
  const copy = sectionCopy[section];
  return (
    <section aria-labelledby={`feed-${section}`}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black" id={`feed-${section}`}>
            {copy.title}
          </h2>
          <p className="mt-1 text-xs font-bold text-[var(--muted)]">{copy.description}</p>
        </div>
        <span className="rounded-full bg-[var(--surface)] px-3 py-1 text-xs font-black">
          {jobs.length}
        </span>
      </div>
      <div className="space-y-4">
        {jobs.map((job) => (
          <JobCard job={job} key={job.jobId} />
        ))}
      </div>
    </section>
  );
}
