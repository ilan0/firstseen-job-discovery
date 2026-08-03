import { ArrowLeft, ArrowUpRight, CheckCircle2, CircleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { getJobDetail } from "@/lib/jobs/queue";

export default async function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const owner = await requireOwner();
  const { jobId } = await params;
  const job = await getJobDetail(owner.id, jobId);
  if (!job) notFound();
  const strengths = Array.isArray(job.strengths) ? (job.strengths as string[]) : [];
  const weaknesses = Array.isArray(job.weaknesses) ? (job.weaknesses as string[]) : [];
  const isOfficiallyOpen = job.lifecycleStatus === "open" || job.lifecycleStatus === "reopened";
  return (
    <div className="mx-auto max-w-5xl">
      <Link
        className="inline-flex items-center gap-1.5 text-sm font-black text-[var(--green)]"
        href="/"
      >
        <ArrowLeft aria-hidden="true" size={16} /> Back to matches
      </Link>
      <header className="mt-6 rounded-[2rem] bg-[var(--green-dark)] p-6 text-white sm:p-9">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-[var(--lime)] px-3 py-1 text-xs font-black text-[var(--ink)] uppercase">
            {job.band ?? "pending"}
          </span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase">
            Urgency {job.urgency ?? "—"}
          </span>
        </div>
        <h1 className="mt-5 text-3xl font-black tracking-[-0.04em] sm:text-5xl">{job.title}</h1>
        <p className="mt-2 text-lg text-white/75">{job.company}</p>
        <p className="mt-5 max-w-3xl leading-7">{job.headline}</p>
        {isOfficiallyOpen ? (
          <Link
            className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--lime)] px-5 text-sm font-black text-[var(--ink)]"
            href={`/jobs/${job.id}/open`}
            target="_blank"
          >
            Open verified official application <ArrowUpRight aria-hidden="true" size={17} />
          </Link>
        ) : (
          <p className="mt-7 inline-flex min-h-11 items-center rounded-xl bg-white/10 px-5 text-sm font-black">
            This official listing is no longer verified as open.
          </p>
        )}
      </header>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <section className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-6">
          <h2 className="text-lg font-black">Eligibility</h2>
          <p className="mt-3 inline-flex items-center gap-2 text-sm font-bold">
            {job.eligibilityOutcome === "eligible" ? (
              <CheckCircle2 className="text-[var(--green)]" size={18} />
            ) : (
              <CircleAlert className="text-[var(--danger)]" size={18} />
            )}
            {job.eligibilityOutcome ?? "Pending"}
          </p>
          <dl className="mt-5 space-y-3 text-sm">
            <div>
              <dt className="font-black">Employment</dt>
              <dd className="mt-1 text-[var(--muted)]">
                {job.employmentType.replaceAll("_", " ")}
              </dd>
            </div>
            <div>
              <dt className="font-black">Official status</dt>
              <dd className="mt-1 text-[var(--muted)]">{job.lifecycleStatus}</dd>
            </div>
            <div>
              <dt className="font-black">Verified</dt>
              <dd className="mt-1 text-[var(--muted)]">
                {job.verifiedAt?.toLocaleString() ?? "Pending"}
              </dd>
            </div>
          </dl>
        </section>
        <section className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-6">
          <h2 className="text-lg font-black">Why this match</h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-black text-[var(--green)]">Strengths</h3>
              <ul className="mt-2 space-y-2 text-sm leading-6">
                {strengths.length ? (
                  strengths.map((item) => <li key={item}>• {item}</li>)
                ) : (
                  <li>Analysis pending.</li>
                )}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-black text-[var(--danger)]">Weaknesses</h3>
              <ul className="mt-2 space-y-2 text-sm leading-6">
                {weaknesses.length ? (
                  weaknesses.map((item) => <li key={item}>• {item}</li>)
                ) : (
                  <li>No material weakness identified.</li>
                )}
              </ul>
            </div>
          </div>
        </section>
      </div>
      <section className="mt-6 rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-6">
        <h2 className="text-lg font-black">Explainable dimensions</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {job.dimensions.map((item) => (
            <div className="rounded-2xl bg-[var(--paper)] p-4" key={item.id}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-black tracking-wide uppercase">
                  {item.dimension.replaceAll("_", " ")}
                </p>
                <p className="text-lg font-black">{item.value}</p>
              </div>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{item.explanation}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
