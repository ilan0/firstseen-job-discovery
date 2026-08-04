"use client";

import { useActionState } from "react";
import { uploadResume, type ResumeUploadState } from "@/app/(app)/applications/actions";
import { SubmitButton } from "@/components/forms/submit-button";

export function ResumeUploadForm() {
  const [state, action] = useActionState<ResumeUploadState, FormData>(uploadResume, {});
  return (
    <form action={action} className="grid gap-3 rounded-2xl bg-[var(--paper)] p-4">
      <label className="grid gap-1 text-xs font-black">
        Version label
        <input
          className="min-h-11 rounded-xl border border-[var(--line)] bg-white px-3 text-sm"
          name="label"
          placeholder="General SWE · Aug 2026"
          required
        />
      </label>
      <label className="grid gap-1 text-xs font-black">
        PDF, DOC, or DOCX · 5 MB maximum
        <input
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="min-h-11 rounded-xl border border-[var(--line)] bg-white p-2 text-xs"
          name="resume"
          required
          type="file"
        />
      </label>
      {state.error ? (
        <p className="text-xs font-bold text-[var(--danger)]" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="text-xs font-bold text-[var(--green)]" role="status">
          {state.success}
        </p>
      ) : null}
      <SubmitButton
        className="min-h-11 rounded-xl bg-[var(--green)] px-4 text-sm font-black text-white"
        pendingLabel="Uploading privately…"
      >
        Save resume version
      </SubmitButton>
    </form>
  );
}
