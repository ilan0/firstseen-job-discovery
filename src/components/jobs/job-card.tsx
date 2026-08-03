import {
  ArrowUpRight,
  Bookmark,
  BriefcaseBusiness,
  Clock3,
  MapPin,
  RotateCcw,
  X,
} from "lucide-react";
import Link from "next/link";
import { transitionQueue } from "@/app/(app)/jobs/actions";
import type { QueueStatus } from "@/lib/jobs/queue";

type JobCardProps = {
  job: {
    jobId: string;
    title: string;
    company: string;
    band: "hot" | "strong" | "possible" | "review" | "not_recommended" | null;
    urgency: number | null;
    headline: string | null;
    firstSeenAt: Date;
    postedAt: Date | null;
    lifecycleStatus: "pending_verification" | "open" | "possibly_closed" | "closed" | "reopened";
    freshnessBand: "hot" | "very_fresh" | "current" | "aging" | "stale";
    rowVersion: number;
    queueStatus: QueueStatus;
    hasReferral: boolean;
  };
};

function timeAgo(date: Date): string {
  const hours = Math.max(0, Math.round((Date.now() - date.getTime()) / 3_600_000));
  return hours < 1 ? "just now" : hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function Action({
  jobId,
  rowVersion,
  status,
  label,
  icon: Icon,
}: {
  jobId: string;
  rowVersion: number;
  status: QueueStatus;
  label: string;
  icon: typeof Bookmark;
}) {
  return (
    <form action={transitionQueue}>
      <input name="jobId" type="hidden" value={jobId} />
      <input name="rowVersion" type="hidden" value={rowVersion} />
      <input name="status" type="hidden" value={status} />
      <button
        className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[var(--line)] bg-white px-3 text-xs font-black transition hover:border-[var(--green)]"
        type="submit"
      >
        <Icon aria-hidden="true" size={15} /> {label}
      </button>
    </form>
  );
}

export function JobCard({ job }: JobCardProps) {
  const isActive = job.queueStatus === "active";
  const isOfficiallyOpen = job.lifecycleStatus === "open" || job.lifecycleStatus === "reopened";
  return (
    <article className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_8px_35px_rgb(23_35_31/5%)] sm:p-6">
      <div className="flex flex-wrap items-center gap-2 text-[0.7rem] font-black tracking-wide uppercase">
        <span
          className={`rounded-full px-2.5 py-1 ${job.band === "hot" ? "bg-[var(--coral)] text-[var(--ink)]" : "bg-[var(--lime)]"}`}
        >
          {job.band ?? "pending"}
        </span>
        {job.hasReferral ? (
          <span className="rounded-full bg-[#e8e0ff] px-2.5 py-1 text-[#54379a]">Referral</span>
        ) : null}
        {!isOfficiallyOpen ? (
          <span className="rounded-full bg-[#f2e8e5] px-2.5 py-1 text-[#7c342b]">
            {job.lifecycleStatus.replaceAll("_", " ")}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1 text-[var(--muted)]">
          <Clock3 aria-hidden="true" size={13} /> Seen {timeAgo(job.firstSeenAt)}
        </span>
      </div>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <Link
            className="text-xl font-black tracking-[-0.025em] hover:text-[var(--green)]"
            href={`/jobs/${job.jobId}`}
          >
            {job.title}
          </Link>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-bold text-[var(--muted)]">
            <MapPin aria-hidden="true" size={15} /> {job.company}
          </p>
        </div>
        <div className="rounded-2xl bg-[var(--paper)] px-3 py-2 text-center">
          <p className="text-xl font-black">{job.urgency ?? "—"}</p>
          <p className="text-[0.62rem] font-black tracking-wider text-[var(--muted)] uppercase">
            Urgency
          </p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6">{job.headline ?? "Analysis is pending."}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {isOfficiallyOpen ? (
          <Link
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[var(--green)] px-4 text-xs font-black text-white hover:bg-[var(--green-dark)]"
            href={`/jobs/${job.jobId}/open`}
            target="_blank"
          >
            Official apply <ArrowUpRight aria-hidden="true" size={15} />
          </Link>
        ) : (
          <span className="inline-flex min-h-10 items-center rounded-xl bg-[var(--paper)] px-4 text-xs font-black text-[var(--muted)]">
            Official application unavailable
          </span>
        )}
        {isActive ? (
          <>
            <Action
              icon={Bookmark}
              jobId={job.jobId}
              label="Save"
              rowVersion={job.rowVersion}
              status="saved"
            />
            <Action
              icon={BriefcaseBusiness}
              jobId={job.jobId}
              label="Applied"
              rowVersion={job.rowVersion}
              status="applied"
            />
            <Action
              icon={X}
              jobId={job.jobId}
              label="Dismiss"
              rowVersion={job.rowVersion}
              status="dismissed"
            />
          </>
        ) : isOfficiallyOpen ? (
          <Action
            icon={RotateCcw}
            jobId={job.jobId}
            label="Restore"
            rowVersion={job.rowVersion}
            status="active"
          />
        ) : null}
      </div>
    </article>
  );
}
