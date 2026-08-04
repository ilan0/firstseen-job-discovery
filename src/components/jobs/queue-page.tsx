import { QueueList } from "./queue-list";
import type { FeedQuery, QueueStatus } from "@/lib/jobs/queue";

export function QueuePage({
  title,
  description,
  jobs,
  status,
  feedQuery,
  olderJobs,
}: {
  title: string;
  description: string;
  jobs: Awaited<ReturnType<typeof import("@/lib/jobs/queue").listQueue>>;
  status: QueueStatus;
  feedQuery?: FeedQuery | undefined;
  olderJobs?: Awaited<ReturnType<typeof import("@/lib/jobs/queue").listQueue>> | undefined;
}) {
  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-7">
        <p className="text-xs font-black tracking-[0.18em] text-[var(--green)] uppercase">
          {status === "active" ? "Fresh opportunities" : "Your decisions"}
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] sm:text-4xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{description}</p>
      </header>
      <QueueList
        feedQuery={feedQuery}
        jobs={jobs}
        key={feedQuery ? JSON.stringify(feedQuery) : status}
        olderJobs={olderJobs}
        status={status}
      />
    </div>
  );
}
