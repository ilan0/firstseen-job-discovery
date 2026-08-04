import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ExternalLink,
  MapPin,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { JobActions } from "@/components/jobs/job-actions";
import { ApplicationLink } from "@/components/applications/application-link";
import { SubmitButton } from "@/components/forms/submit-button";
import { resolveApplicationSession } from "@/app/(app)/applications/actions";
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
  const facts = job.eligibilityFacts as {
    experienceRequirements?: Array<{
      minimumYears?: number;
      maximumYears?: number | null;
      preferred?: boolean;
    }>;
    locations?: { value?: unknown };
    workArrangement?: { value?: unknown };
    roleFamily?: { value?: unknown };
    clearance?: { value?: unknown };
    publicTrust?: { value?: unknown };
    sponsorship?: { value?: unknown };
  } | null;
  const locations = Array.isArray(facts?.locations?.value)
    ? facts.locations.value.filter((location): location is string => typeof location === "string")
    : [];
  const requiredExperience = facts?.experienceRequirements
    ?.filter((requirement) => !requirement.preferred)
    .map((requirement) =>
      requirement.maximumYears && requirement.maximumYears !== requirement.minimumYears
        ? `${requirement.minimumYears ?? 0}–${requirement.maximumYears} years`
        : `${requirement.minimumYears ?? 0}+ years`,
    );
  const eligibilityReasons = Array.isArray(job.eligibilityReasons)
    ? (job.eligibilityReasons as Array<{ message?: string }>).filter(
        (reason) => typeof reason.message === "string",
      )
    : [];
  const routingReasons = Array.isArray(job.routingReasons)
    ? job.routingReasons.filter((reason): reason is string => typeof reason === "string")
    : [];
  const uncertainFields = job.uncertainFields ?? [];
  const sourceHostname = new URL(job.officialUrl).hostname;
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
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase">
            {job.freshness.band.replaceAll("_", " ")}
          </span>
          {job.materialChangeReasons?.length ? (
            <span className="rounded-full bg-[#fff0d8] px-3 py-1 text-xs font-black text-[#7a4c0d] uppercase">
              Updated · {job.materialChangeReasons.join(", ")}
            </span>
          ) : null}
        </div>
        <h1 className="mt-5 text-3xl font-black tracking-[-0.04em] sm:text-5xl">{job.title}</h1>
        <p className="mt-2 flex items-center gap-2 text-lg text-white/75">
          <Building2 aria-hidden="true" size={18} /> {job.company}
        </p>
        <p className="mt-2 flex items-start gap-2 text-sm text-white/70">
          <MapPin aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
          {locations.join(" · ") || "Location not provided"}
        </p>
        <p className="mt-5 max-w-3xl leading-7">{job.headline}</p>
        {isOfficiallyOpen ? (
          <ApplicationLink jobId={job.id} />
        ) : (
          <p className="mt-7 inline-flex min-h-11 items-center rounded-xl bg-white/10 px-5 text-sm font-black">
            This official listing is no longer verified as open.
          </p>
        )}
        <JobActions
          jobId={job.id}
          officiallyOpen={isOfficiallyOpen}
          rowVersion={job.rowVersion}
          status={job.status}
        />
      </header>
      {job.pendingApplicationSession ? (
        <section className="mt-6 rounded-[1.5rem] border border-[var(--green)] bg-[#e7f6ef] p-5 sm:flex sm:items-center sm:justify-between sm:gap-5">
          <div>
            <p className="font-black">
              {job.pendingApplicationSession.disposition === "continue_later"
                ? "Ready to finish this application?"
                : "Did you submit this application?"}
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {job.pendingApplicationSession.disposition === "continue_later"
                ? "Your place is saved. Confirm only after you actually submit on the employer page."
                : "Opening the employer page did not change your status. Confirm only after you actually submitted it."}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 sm:mt-0">
            {[
              ["submitted", "Yes, submitted"],
              ["continue_later", "Continue later"],
              ["dismissed", "Dismiss prompt"],
            ].map(([disposition, label]) => (
              <form action={resolveApplicationSession} key={disposition}>
                <input name="sessionId" type="hidden" value={job.pendingApplicationSession?.id} />
                <input name="disposition" type="hidden" value={disposition} />
                <SubmitButton
                  className={`min-h-11 rounded-xl px-4 text-xs font-black ${disposition === "submitted" ? "bg-[var(--green)] text-white" : "border border-[var(--line)] bg-white"}`}
                  pendingLabel="Saving…"
                >
                  {label}
                </SubmitButton>
              </form>
            ))}
          </div>
        </section>
      ) : null}
      {job.recommendedContact ? (
        <section className="mt-6 rounded-[1.5rem] border border-[#b9ddcd] bg-[#eef8f3] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-xs font-black tracking-[0.12em] text-[var(--green)] uppercase">
                <UsersRound aria-hidden="true" size={17} /> Best referral contact
              </p>
              <h2 className="mt-2 text-xl font-black">{job.recommendedContact.name}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {[job.recommendedContact.title, job.recommendedContact.team]
                  .filter(Boolean)
                  .join(" · ") || "Relationship contact"}
              </p>
              <ul className="mt-3 space-y-1 text-xs text-[var(--muted)]">
                {job.recommendedContact.reasons.map((reason) => (
                  <li key={reason}>• {reason}</li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap gap-2">
              {job.recommendedContact.methods
                .filter((method) => method.kind === "email" || method.kind === "profile_url")
                .map((method) => (
                  <a
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--green)] px-4 text-xs font-black text-white"
                    href={method.kind === "email" ? `mailto:${method.value}` : method.value}
                    key={`${method.kind}:${method.value}`}
                    rel={method.kind === "profile_url" ? "noopener noreferrer" : undefined}
                    target={method.kind === "profile_url" ? "_blank" : undefined}
                  >
                    Contact referral <ExternalLink aria-hidden="true" size={14} />
                  </a>
                ))}
              <Link
                className="inline-flex min-h-11 items-center rounded-xl border border-[var(--line)] bg-white px-4 text-xs font-black"
                href="/relationships"
              >
                View relationship
              </Link>
            </div>
          </div>
        </section>
      ) : job.referrals.length ? (
        <section className="mt-6 rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-5 text-sm">
          <p className="font-black">Referral available</p>
          <p className="mt-1 text-[var(--muted)]">
            Add this referral to People to receive a best-contact recommendation and follow-up
            reminders.
          </p>
          <Link className="mt-3 inline-flex font-black text-[var(--green)]" href="/relationships">
            Set up relationship →
          </Link>
        </section>
      ) : null}
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
              <dt className="font-black">Required experience</dt>
              <dd className="mt-1 text-[var(--muted)]">
                {requiredExperience?.join(" · ") || "No explicit minimum found"}
              </dd>
            </div>
            <div>
              <dt className="font-black">Role family</dt>
              <dd className="mt-1 text-[var(--muted)]">
                {typeof facts?.roleFamily?.value === "string"
                  ? facts.roleFamily.value.replaceAll("_", " ")
                  : "Unknown"}
              </dd>
            </div>
            <div>
              <dt className="font-black">Work arrangement</dt>
              <dd className="mt-1 text-[var(--muted)]">
                {typeof facts?.workArrangement?.value === "string"
                  ? facts.workArrangement.value.replaceAll("_", " ")
                  : "Unknown"}
              </dd>
            </div>
            <div>
              <dt className="font-black">Security clearance</dt>
              <dd className="mt-1 text-[var(--muted)]">
                {typeof facts?.clearance?.value === "string"
                  ? facts.clearance.value.replaceAll("_", " ")
                  : "Unknown"}
              </dd>
            </div>
            <div>
              <dt className="font-black">Public Trust</dt>
              <dd className="mt-1 text-[var(--muted)]">
                {typeof facts?.publicTrust?.value === "string"
                  ? facts.publicTrust.value.replaceAll("_", " ")
                  : "Unknown"}
              </dd>
            </div>
            <div>
              <dt className="font-black">Sponsorship compatibility</dt>
              <dd className="mt-1 text-[var(--muted)]">
                {typeof facts?.sponsorship?.value === "string"
                  ? facts.sponsorship.value.replaceAll("_", " ")
                  : "Unknown"}
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
      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <Metadata
          icon={<CalendarDays aria-hidden="true" size={18} />}
          label="Officially posted"
          value={
            job.postedAt && job.postedAtConfidence !== "low"
              ? job.postedAt.toLocaleString("en-US", { timeZone: "America/New_York" })
              : "Unavailable or low confidence — freshness uses first verified sighting"
          }
        />
        <Metadata
          icon={<Clock3 aria-hidden="true" size={18} />}
          label="FirstSeen detected"
          value={job.firstSeenAt.toLocaleString("en-US", { timeZone: "America/New_York" })}
        />
        <Metadata
          icon={<ShieldCheck aria-hidden="true" size={18} />}
          label="Authoritative source"
          value={`${sourceHostname} · ${job.sourceKind.replaceAll("_", " ")} · ${job.sourceConfidence}% confidence`}
        />
        <Metadata
          icon={<Clock3 aria-hidden="true" size={18} />}
          label="Last officially verified"
          value={
            job.verifiedAt?.toLocaleString("en-US", { timeZone: "America/New_York" }) ?? "Pending"
          }
        />
        {job.reopenedAt ? (
          <Metadata
            icon={<Clock3 aria-hidden="true" size={18} />}
            label="Verified reopening"
            value={job.reopenedAt.toLocaleString("en-US", { timeZone: "America/New_York" })}
          />
        ) : null}
      </section>
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
      {eligibilityReasons.length || routingReasons.length || uncertainFields.length ? (
        <section className="mt-6 rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-6">
          <h2 className="text-lg font-black">Decision notes</h2>
          <ul className="mt-4 space-y-2 text-sm leading-6 text-[var(--muted)]">
            {eligibilityReasons.map((reason) => (
              <li key={reason.message}>• {reason.message}</li>
            ))}
            {routingReasons.map((reason) => (
              <li key={reason}>• {reason}</li>
            ))}
            {uncertainFields.map((field) => (
              <li key={field}>• Needs review: {field.replaceAll("_", " ")}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {job.descriptionText ? (
        <details className="mt-6 rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-6">
          <summary className="font-black">Official job description</summary>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Captured{" "}
            {job.snapshotCapturedAt?.toLocaleString("en-US", { timeZone: "America/New_York" })}
          </p>
          <div className="mt-5 max-h-[40rem] overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-[var(--muted)]">
            {job.descriptionText}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function Metadata({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <article className="rounded-[1.25rem] border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="text-[var(--green)]">{icon}</div>
      <p className="mt-4 text-xs font-black tracking-wide text-[var(--muted)] uppercase">{label}</p>
      <p className="mt-1 text-sm font-bold">{value}</p>
    </article>
  );
}
