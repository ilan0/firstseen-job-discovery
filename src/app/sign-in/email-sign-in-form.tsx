"use client";

import { useActionState } from "react";
import { requestEmailSignIn, type SignInState } from "./actions";

export function EmailSignInForm({ next = "/" }: { next?: string }) {
  const [state, action, pending] = useActionState<SignInState & { success?: string }, FormData>(
    requestEmailSignIn,
    {},
  );
  return (
    <form action={action} className="mt-7 space-y-4">
      <input name="next" type="hidden" value={next} />
      <label className="block text-sm font-bold" htmlFor="email">
        Invited email
      </label>
      <input
        autoComplete="email"
        className="min-h-12 w-full rounded-2xl border border-[var(--line)] bg-white px-4"
        id="email"
        name="email"
        required
        type="email"
      />
      {state.error ? (
        <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="rounded-xl bg-lime-50 p-3 text-sm font-bold text-green-900" role="status">
          {state.success}
        </p>
      ) : null}
      <button
        className="min-h-12 w-full rounded-2xl bg-[var(--green)] px-5 font-bold text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Sending link…" : "Email me a secure link"}
      </button>
    </form>
  );
}
