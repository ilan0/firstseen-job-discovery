"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

const initialState: SignInState = {};

export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, initialState);

  return (
    <form action={action} className="mt-9 space-y-5" noValidate>
      <div>
        <label className="mb-2 block text-sm font-bold" htmlFor="email">
          Email
        </label>
        <input
          autoComplete="email"
          className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3.5 shadow-inner"
          id="email"
          name="email"
          required
          type="email"
        />
      </div>
      <div>
        <label className="mb-2 block text-sm font-bold" htmlFor="password">
          Password
        </label>
        <input
          autoComplete="current-password"
          className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3.5 shadow-inner"
          id="password"
          name="password"
          required
          type="password"
        />
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
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
