"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

const initialState: SignInState = {};

export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, initialState);

  return (
    <form action={action} className="mt-9 space-y-5" noValidate>
      <div>
        <label className="mb-2 block text-sm font-bold" htmlFor="code">
          Access code
        </label>
        <input
          aria-describedby="code-hint"
          autoComplete="one-time-code"
          autoFocus
          className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-4 text-center text-3xl font-black tracking-[0.85em] tabular-nums shadow-inner"
          id="code"
          inputMode="numeric"
          maxLength={4}
          name="code"
          pattern="[0-9]{4}"
          required
          type="password"
        />
        <p className="mt-2 text-sm text-[var(--muted)]" id="code-hint">
          Four digits. This device stays signed in securely.
        </p>
      </div>
      {state.error ? (
        <p
          className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      <button
        className="w-full rounded-2xl bg-[var(--green)] px-5 py-3.5 font-bold text-white transition hover:bg-[var(--green-dark)] disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Opening FirstSeen…" : "Open FirstSeen"}
      </button>
    </form>
  );
}
