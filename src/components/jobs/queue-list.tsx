"use client";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import Link from "next/link";
import { JobCard } from "./job-card";
import type { QueueStatus, listQueue } from "@/lib/jobs/queue";

type Jobs = Awaited<ReturnType<typeof listQueue>>;
export function QueueList({ jobs, status }: { jobs: Jobs; status: QueueStatus }) {
  const [query, setQuery] = useState("");
  const [band, setBand] = useState("all");
  const [referralsOnly, setReferralsOnly] = useState(false);
  const [sort, setSort] = useState("urgency");
  const filtered = useMemo(
    () =>
      jobs
        .filter((job) => `${job.title} ${job.company}`.toLowerCase().includes(query.toLowerCase()))
        .filter((job) => band === "all" || job.band === band)
        .filter((job) => !referralsOnly || job.hasReferral)
        .toSorted((a, b) =>
          sort === "fresh"
            ? b.firstSeenAt.getTime() - a.firstSeenAt.getTime()
            : (b.urgency ?? -1) - (a.urgency ?? -1),
        ),
    [jobs, query, band, referralsOnly, sort],
  );
  if (!jobs.length)
    return (
      <section className="rounded-[2rem] border border-dashed border-[var(--line)] bg-[var(--surface)] px-6 py-14 text-center">
        <h2 className="text-xl font-black">Nothing here yet</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">
          {status === "active"
            ? "Add priority companies to the watchlist. Verified matches will appear here automatically."
            : "Jobs move here immediately when you take that action."}
        </p>
        {status === "active" ? (
          <Link
            className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[var(--green)] px-5 text-sm font-black text-white"
            href="/watchlist"
          >
            Add a priority company
          </Link>
        ) : null}
      </section>
    );
  return (
    <>
      <div className="mb-5 grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 sm:grid-cols-[1fr_auto_auto_auto]">
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
        <select
          aria-label="Filter match type"
          className="min-h-10 rounded-xl bg-[var(--paper)] px-3 text-xs font-black"
          onChange={(event) => setBand(event.target.value)}
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
            onChange={(event) => setReferralsOnly(event.target.checked)}
            type="checkbox"
          />{" "}
          Referrals
        </label>
        <select
          aria-label="Sort jobs"
          className="min-h-10 rounded-xl bg-[var(--paper)] px-3 text-xs font-black"
          onChange={(event) => setSort(event.target.value)}
          value={sort}
        >
          <option value="urgency">Most urgent</option>
          <option value="fresh">Newest seen</option>
        </select>
      </div>
      <div className="mb-4 flex min-h-8 flex-wrap items-center justify-between gap-3 text-xs font-bold text-[var(--muted)]">
        <p aria-live="polite">
          Showing {filtered.length} of {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
        </p>
        {query || band !== "all" || referralsOnly || sort !== "urgency" ? (
          <button
            className="rounded-lg px-2 py-1 font-black text-[var(--green)] hover:bg-[var(--surface)]"
            onClick={() => {
              setQuery("");
              setBand("all");
              setReferralsOnly(false);
              setSort("urgency");
            }}
            type="button"
          >
            Reset filters
          </button>
        ) : null}
      </div>
      {filtered.length ? (
        <div className="space-y-4">
          {filtered.map((job) => (
            <JobCard job={job} key={job.jobId} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--line)] p-10 text-center text-sm font-bold text-[var(--muted)]">
          No jobs match these filters.
        </div>
      )}
    </>
  );
}
