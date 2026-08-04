import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { ArrowUpRight, CalendarClock, FileStack, History, TrendingUp } from "lucide-react";
import Link from "next/link";
import {
  addApplicationFollowup,
  completeApplicationFollowup,
  transitionApplicationStage,
  updateApplicationDetails,
} from "../applications/actions";
import { SubmitButton } from "@/components/forms/submit-button";
import { QueuePage } from "@/components/jobs/queue-page";
import { rolloutFlags } from "@/config/rollout";
import { db } from "@/db/client";
import {
  applicationFollowups,
  applicationSessions,
  applications,
  applicationStageHistory,
  canonicalJobs,
  companies,
  contacts,
  organizations,
  referralRequests,
  resumeVersions,
} from "@/db/schema";
import { nextApplicationStages, type ApplicationStage } from "@/domain/applications/stages";
import { requireOwner } from "@/lib/auth/owner";
import { listQueue } from "@/lib/jobs/queue";

export default async function AppliedPage() {
  const owner = await requireOwner();
  if (!rolloutFlags().applicationWorkflow) {
    return (
      <QueuePage
        description="A lightweight record of applications submitted through official employer pages."
        jobs={await listQueue(owner.id, "applied")}
        status="applied"
        title="Applied jobs"
      />
    );
  }
  const [rows, history, followups, resumes, availableReferrals] = await Promise.all([
    db
      .select({
        id: applications.id,
        stage: applications.stage,
        appliedAt: applications.appliedAt,
        source: applications.source,
        inferred: applications.inferred,
        notes: applications.notes,
        resumeVersionId: applications.resumeVersionId,
        referralRequestId: applications.referralRequestId,
        appliedThisWeek: sql<boolean>`${applications.appliedAt} >= now() - interval '7 days'`,
        sessionOpenedAt: applicationSessions.openedAt,
        legacyJobId: applications.legacyJobId,
        title: canonicalJobs.title,
        officialUrl: canonicalJobs.officialUrl,
        company: companies.name,
      })
      .from(applications)
      .leftJoin(canonicalJobs, eq(applications.legacyJobId, canonicalJobs.id))
      .leftJoin(companies, eq(canonicalJobs.companyId, companies.id))
      .leftJoin(applicationSessions, eq(applications.applicationSessionId, applicationSessions.id))
      .where(and(eq(applications.userId, owner.id), isNull(applications.archivedAt)))
      .orderBy(desc(applications.appliedAt)),
    db
      .select()
      .from(applicationStageHistory)
      .where(eq(applicationStageHistory.userId, owner.id))
      .orderBy(desc(applicationStageHistory.transitionedAt)),
    db
      .select()
      .from(applicationFollowups)
      .where(
        and(
          eq(applicationFollowups.userId, owner.id),
          isNull(applicationFollowups.completedAt),
          isNull(applicationFollowups.dismissedAt),
        ),
      )
      .orderBy(asc(applicationFollowups.dueAt)),
    db
      .select({ id: resumeVersions.id, label: resumeVersions.label })
      .from(resumeVersions)
      .where(and(eq(resumeVersions.userId, owner.id), eq(resumeVersions.active, true)))
      .orderBy(desc(resumeVersions.createdAt)),
    db
      .select({
        id: referralRequests.id,
        status: referralRequests.status,
        contact: contacts.name,
        company: organizations.name,
      })
      .from(referralRequests)
      .innerJoin(contacts, eq(referralRequests.contactId, contacts.id))
      .innerJoin(organizations, eq(referralRequests.organizationId, organizations.id))
      .where(eq(referralRequests.userId, owner.id))
      .orderBy(desc(referralRequests.updatedAt)),
  ]);
  const group = <T extends { applicationId: string }>(values: T[]) => {
    const map = new Map<string, T[]>();
    for (const value of values)
      map.set(value.applicationId, [...(map.get(value.applicationId) ?? []), value]);
    return map;
  };
  const historyByApplication = group(history);
  const followupsByApplication = group(followups);
  const activeStages = new Set(["recruiter_screen", "interview", "final", "offer"]);
  const activeCount = rows.filter((row) => activeStages.has(row.stage)).length;
  const responseCount = rows.filter((row) => row.stage !== "applied").length;
  const responseRate = rows.length ? Math.round((responseCount / rows.length) * 100) : 0;
  const weeklyCount = rows.filter((row) => row.appliedThisWeek).length;
  const referralUsage = rows.filter((row) => row.referralRequestId).length;
  const openToApplyMinutes = rows
    .filter((row) => row.sessionOpenedAt)
    .map((row) => Math.max(0, row.appliedAt.getTime() - row.sessionOpenedAt!.getTime()) / 60_000);
  const averageOpenToApply = openToApplyMinutes.length
    ? Math.round(
        openToApplyMinutes.reduce((sum, value) => sum + value, 0) / openToApplyMinutes.length,
      )
    : null;

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-xs font-black tracking-[0.18em] text-[var(--green)] uppercase">
            Outcome loop
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-[-0.04em]">Applications</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Opening an official page never marks a job applied. Only your explicit submission
            confirmation creates this record.
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--green)] px-4 text-sm font-black text-white"
          href="/applications/packet"
        >
          <FileStack aria-hidden="true" size={17} /> Application packet
        </Link>
      </header>
      <section aria-label="Application summary" className="mt-7 grid gap-3 sm:grid-cols-3">
        <Metric label="Total submitted" value={rows.length} />
        <Metric label="Active conversations" value={activeCount} />
        <Metric label="Response rate" suffix="%" value={responseRate} />
        <Metric label="Applied in the last 7 days" value={weeklyCount} />
        <Metric label="Applications using a referral" value={referralUsage} />
        <Metric
          label="Average official-open to apply"
          suffix={averageOpenToApply === null ? "" : "m"}
          value={averageOpenToApply ?? 0}
        />
      </section>
      <section className="mt-7">
        {rows.length ? (
          <div className="space-y-4">
            {rows.map((application) => {
              const allowed = nextApplicationStages(application.stage as ApplicationStage);
              const appHistory = historyByApplication.get(application.id) ?? [];
              const appFollowups = followupsByApplication.get(application.id) ?? [];
              return (
                <article
                  className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6"
                  key={application.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-[#e7f6ef] px-2.5 py-1 text-[0.68rem] font-black text-[var(--green)] uppercase">
                          {application.stage.replaceAll("_", " ")}
                        </span>
                        {application.inferred ? (
                          <span className="rounded-full bg-[#fff0d8] px-2.5 py-1 text-[0.68rem] font-black text-[#7a4c0d] uppercase">
                            Historical · inferred
                          </span>
                        ) : null}
                      </div>
                      <h2 className="mt-3 text-xl font-black">
                        {application.title ?? "Archived job"}
                      </h2>
                      <p className="mt-1 text-sm font-bold text-[var(--muted)]">
                        {application.company ?? "Company unavailable"}
                      </p>
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        Applied {application.appliedAt.toLocaleString()} ·{" "}
                        {application.source.replaceAll("_", " ")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {application.legacyJobId ? (
                        <Link
                          className="inline-flex min-h-10 items-center rounded-xl border border-[var(--line)] px-3 text-xs font-black"
                          href={`/jobs/${application.legacyJobId}`}
                        >
                          Job detail
                        </Link>
                      ) : null}
                      {application.officialUrl ? (
                        <a
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[var(--line)] px-3 text-xs font-black text-[var(--green)]"
                          href={application.officialUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Official page <ArrowUpRight size={14} />
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-5 grid gap-4 lg:grid-cols-3">
                    <section className="rounded-2xl bg-[var(--paper)] p-4">
                      <h3 className="text-xs font-black tracking-wide uppercase">Move forward</h3>
                      {allowed.length ? (
                        <form action={transitionApplicationStage} className="mt-3 grid gap-2">
                          <input name="applicationId" type="hidden" value={application.id} />
                          <select
                            aria-label={`Next application stage for ${application.title ?? "archived job"}`}
                            className="min-h-10 rounded-xl border border-[var(--line)] bg-white px-2 text-xs"
                            name="stage"
                            required
                            defaultValue=""
                          >
                            <option disabled value="">
                              Choose next stage
                            </option>
                            {allowed.map((stage) => (
                              <option key={stage} value={stage}>
                                {stage.replaceAll("_", " ")}
                              </option>
                            ))}
                          </select>
                          <input
                            className="min-h-10 rounded-xl border border-[var(--line)] bg-white px-3 text-xs"
                            maxLength={500}
                            name="reason"
                            placeholder="Optional context"
                          />
                          <SubmitButton
                            className="min-h-10 rounded-xl bg-[var(--green)] px-3 text-xs font-black text-white"
                            pendingLabel="Updating…"
                          >
                            Update stage
                          </SubmitButton>
                        </form>
                      ) : (
                        <p className="mt-3 text-xs text-[var(--muted)]">
                          This is a terminal stage.
                        </p>
                      )}
                    </section>
                    <section className="rounded-2xl bg-[var(--paper)] p-4">
                      <h3 className="flex items-center gap-2 text-xs font-black tracking-wide uppercase">
                        <CalendarClock size={15} /> Follow-up
                      </h3>
                      {appFollowups.map((followup) => (
                        <div className="mt-3 text-xs" key={followup.id}>
                          <p className="font-black">{followup.nextAction}</p>
                          <p className="mt-1 text-[var(--muted)]">
                            Due {followup.dueAt.toLocaleDateString()}
                          </p>
                          <form action={completeApplicationFollowup} className="mt-1">
                            <input name="followupId" type="hidden" value={followup.id} />
                            <SubmitButton
                              className="font-black text-[var(--green)]"
                              pendingLabel="Completing…"
                            >
                              Done
                            </SubmitButton>
                          </form>
                        </div>
                      ))}
                      <form action={addApplicationFollowup} className="mt-3 grid gap-2">
                        <input name="applicationId" type="hidden" value={application.id} />
                        <input
                          aria-label={`Follow-up action for ${application.title}`}
                          className="min-h-10 rounded-xl border border-[var(--line)] bg-white px-3 text-xs"
                          name="nextAction"
                          placeholder="Check in with recruiter"
                          required
                        />
                        <input
                          aria-label={`Follow-up date for ${application.title}`}
                          className="min-h-10 rounded-xl border border-[var(--line)] bg-white px-3 text-xs"
                          name="dueDate"
                          required
                          type="date"
                        />
                        <SubmitButton
                          className="min-h-10 rounded-xl border border-[var(--line)] px-3 text-xs font-black"
                          pendingLabel="Scheduling…"
                        >
                          Schedule
                        </SubmitButton>
                      </form>
                    </section>
                    <section className="rounded-2xl bg-[var(--paper)] p-4">
                      <h3 className="flex items-center gap-2 text-xs font-black tracking-wide uppercase">
                        <History size={15} /> History
                      </h3>
                      <ol className="mt-3 space-y-3 text-xs">
                        {appHistory.map((entry) => (
                          <li key={entry.id}>
                            <p className="font-black">{entry.toStage.replaceAll("_", " ")}</p>
                            <p className="mt-1 text-[var(--muted)]">
                              {entry.transitionedAt.toLocaleDateString()} · {entry.reason}
                            </p>
                          </li>
                        ))}
                      </ol>
                    </section>
                  </div>
                  <details
                    className="mt-4 rounded-2xl bg-[var(--paper)] p-4"
                    open={Boolean(application.notes)}
                  >
                    <summary className="cursor-pointer text-xs font-black tracking-wide uppercase">
                      Application details
                    </summary>
                    <form
                      action={updateApplicationDetails}
                      className="mt-4 grid gap-3 sm:grid-cols-2"
                    >
                      <input name="applicationId" type="hidden" value={application.id} />
                      <label className="grid gap-1 text-xs font-black">
                        Resume used
                        <select
                          className="min-h-10 rounded-xl border border-[var(--line)] bg-white px-3"
                          defaultValue={application.resumeVersionId ?? ""}
                          name="resumeVersionId"
                        >
                          <option value="">Not recorded</option>
                          {resumes.map((resume) => (
                            <option key={resume.id} value={resume.id}>
                              {resume.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-black">
                        Referral used
                        <select
                          className="min-h-10 rounded-xl border border-[var(--line)] bg-white px-3"
                          defaultValue={application.referralRequestId ?? ""}
                          name="referralRequestId"
                        >
                          <option value="">No referral recorded</option>
                          {availableReferrals.map((referral) => (
                            <option key={referral.id} value={referral.id}>
                              {referral.contact} · {referral.company} · {referral.status}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-black sm:col-span-2">
                        Notes
                        <textarea
                          className="min-h-24 rounded-xl border border-[var(--line)] bg-white p-3 font-normal leading-5"
                          defaultValue={application.notes ?? ""}
                          maxLength={5_000}
                          name="notes"
                          placeholder="Recruiter, submission, or interview context"
                        />
                      </label>
                      <SubmitButton
                        className="min-h-10 rounded-xl bg-[var(--green)] px-4 text-xs font-black text-white sm:col-span-2 sm:justify-self-start"
                        pendingLabel="Saving details…"
                      >
                        Save application details
                      </SubmitButton>
                    </form>
                  </details>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[1.5rem] border border-dashed border-[var(--line)] bg-[var(--surface)] px-6 py-16 text-center">
            <TrendingUp aria-hidden="true" className="mx-auto text-[var(--green)]" size={32} />
            <p className="mt-4 font-black">No confirmed applications yet</p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Apply on an official page, then explicitly confirm submission.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <p className="text-2xl font-black">
        {value}
        {suffix}
      </p>
      <p className="mt-1 text-xs font-bold text-[var(--muted)]">{label}</p>
    </article>
  );
}
