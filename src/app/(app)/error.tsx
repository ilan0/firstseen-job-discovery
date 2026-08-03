"use client";
import { useEffect } from "react";
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Workspace request failed", { digest: error.digest });
  }, [error]);
  return (
    <section className="mx-auto max-w-2xl rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-8 text-center">
      <p className="text-xs font-black tracking-[0.18em] text-[var(--danger)] uppercase">
        Temporary problem
      </p>
      <h1 className="mt-3 text-3xl font-black">This view could not be loaded.</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        Your data and queue actions remain safe. Check the connection and try again.
      </p>
      <button
        className="mt-6 min-h-11 rounded-xl bg-[var(--green)] px-5 text-sm font-black text-white"
        onClick={reset}
        type="button"
      >
        Try again
      </button>
    </section>
  );
}
