import { asc, and, desc, eq } from "drizzle-orm";
import { Download, FileText, KeyRound, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addPacketEntry, deactivateResume, deletePacketEntry } from "../actions";
import { CopyValue } from "@/components/applications/copy-value";
import { ResumeUploadForm } from "@/components/applications/resume-upload-form";
import { ConfirmSubmit } from "@/components/forms/confirm-submit";
import { SubmitButton } from "@/components/forms/submit-button";
import { db } from "@/db/client";
import { applicationPacketEntries, resumeVersions } from "@/db/schema";
import { requireOwner } from "@/lib/auth/owner";
import { rolloutFlags } from "@/config/rollout";

export default async function ApplicationPacketPage() {
  if (!rolloutFlags().applicationWorkflow) notFound();
  const owner = await requireOwner();
  const [resumes, entries] = await Promise.all([
    db
      .select()
      .from(resumeVersions)
      .where(and(eq(resumeVersions.userId, owner.id), eq(resumeVersions.active, true)))
      .orderBy(desc(resumeVersions.createdAt)),
    db
      .select()
      .from(applicationPacketEntries)
      .where(
        and(
          eq(applicationPacketEntries.userId, owner.id),
          eq(applicationPacketEntries.active, true),
        ),
      )
      .orderBy(asc(applicationPacketEntries.displayOrder), asc(applicationPacketEntries.label)),
  ]);
  return (
    <div className="mx-auto max-w-5xl">
      <Link className="text-sm font-black text-[var(--green)]" href="/applied">
        ← Applications
      </Link>
      <header className="mt-5">
        <p className="text-xs font-black tracking-[0.18em] text-[var(--green)] uppercase">
          Reusable answers
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-[-0.04em]">Application packet</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          Your private, mobile-ready kit for official application pages that do not support browser
          autofill.
        </p>
      </header>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-lg font-black">
            <FileText size={19} /> Resume versions
          </h2>
          <div className="mt-4 space-y-2">
            {resumes.map((resume) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-3"
                key={resume.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-black">{resume.label}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {resume.originalFilename} · {(resume.sizeBytes / 1024).toFixed(0)} KB
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    className="grid min-h-10 place-items-center rounded-xl border border-[var(--line)] px-3"
                    href={`/applications/resumes/${resume.id}`}
                  >
                    <Download aria-label={`Download ${resume.label}`} size={15} />
                  </Link>
                  <form action={deactivateResume}>
                    <input name="resumeId" type="hidden" value={resume.id} />
                    <ConfirmSubmit
                      className="min-h-10 text-xs font-black text-[var(--danger)]"
                      message={`Hide ${resume.label}? The stored version will be retained.`}
                    >
                      Hide
                    </ConfirmSubmit>
                  </form>
                </div>
              </div>
            ))}
            {!resumes.length ? (
              <p className="py-4 text-sm text-[var(--muted)]">No reusable resume uploaded yet.</p>
            ) : null}
          </div>
          <div className="mt-5">
            <ResumeUploadForm />
          </div>
        </section>
        <section className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-lg font-black">
            <KeyRound size={19} /> Facts and answers
          </h2>
          <div className="mt-4 space-y-2">
            {entries.map((entry) => (
              <article className="rounded-xl border border-[var(--line)] p-3" key={entry.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[0.68rem] font-black tracking-wide text-[var(--muted)] uppercase">
                      {entry.category}
                      {entry.sensitive ? " · private" : ""}
                    </p>
                    <p className="mt-1 text-sm font-black">{entry.label}</p>
                    <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-[var(--muted)]">
                      {entry.value}
                    </p>
                  </div>
                  <CopyValue label={entry.label} value={entry.value} />
                </div>
                <form action={deletePacketEntry} className="mt-2">
                  <input name="entryId" type="hidden" value={entry.id} />
                  <SubmitButton
                    className="text-xs font-black text-[var(--danger)]"
                    pendingLabel="Removing…"
                  >
                    Remove
                  </SubmitButton>
                </form>
              </article>
            ))}
          </div>
          <details className="mt-5 rounded-2xl bg-[var(--paper)] p-4" open={!entries.length}>
            <summary className="flex items-center gap-2 text-sm font-black">
              <Plus size={16} /> Add reusable answer
            </summary>
            <form action={addPacketEntry} className="mt-4 grid gap-3">
              <input
                className="min-h-11 rounded-xl border border-[var(--line)] bg-white px-3 text-sm"
                name="category"
                placeholder="Identity, links, work authorization…"
                required
              />
              <input
                className="min-h-11 rounded-xl border border-[var(--line)] bg-white px-3 text-sm"
                name="label"
                placeholder="Portfolio URL"
                required
              />
              <textarea
                className="min-h-24 rounded-xl border border-[var(--line)] bg-white p-3 text-sm"
                name="value"
                placeholder="Reusable value or answer"
                required
              />
              <label className="flex items-center gap-2 text-xs font-black">
                <input name="sensitive" type="checkbox" /> Treat as sensitive personal data
              </label>
              <SubmitButton
                className="min-h-11 rounded-xl bg-[var(--green)] px-4 text-sm font-black text-white"
                pendingLabel="Saving…"
              >
                Save answer
              </SubmitButton>
            </form>
          </details>
        </section>
      </div>
    </div>
  );
}
