"use client";
import { useActionState, useEffect, useRef } from "react";
import { Building2, Link2, UserRoundPlus } from "lucide-react";
import { addWatchCompany, type WatchlistFormState } from "@/app/(app)/watchlist/actions";

const initialState: WatchlistFormState = {};
export function WatchlistForm() {
  const [state, action, pending] = useActionState(addWatchCompany, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);
  return (
    <form
      action={action}
      className="h-fit rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-5"
      ref={formRef}
    >
      <h2 className="flex items-center gap-2 font-black">
        <Building2 aria-hidden="true" size={19} /> Add a company
      </h2>
      <div className="mt-5 space-y-4">
        <label className="flex min-h-11 items-center gap-3 rounded-xl bg-[var(--paper)] px-3 text-xs font-black">
          <input defaultChecked name="interested" type="checkbox" />
          I’m interested in this company
        </label>
        <label className="block text-xs font-black">
          Company name
          <input
            className="mt-1.5 min-h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-sm"
            autoComplete="organization"
            name="company"
            required
          />
        </label>
        <label className="block text-xs font-black">
          Official careers or ATS URL
          <div className="relative mt-1.5">
            <Link2 className="absolute top-3 left-3 text-[var(--muted)]" size={17} />
            <input
              className="min-h-11 w-full rounded-xl border border-[var(--line)] bg-white pr-3 pl-10 text-sm"
              autoComplete="url"
              name="careerUrl"
              placeholder="https://jobs.lever.co/company"
              required
              type="url"
            />
          </div>
        </label>
        <label className="block text-xs font-black">
          Referral person (optional)
          <div className="relative mt-1.5">
            <UserRoundPlus className="absolute top-3 left-3 text-[var(--muted)]" size={17} />
            <input
              className="min-h-11 w-full rounded-xl border border-[var(--line)] bg-white pr-3 pl-10 text-sm"
              autoComplete="name"
              name="referralPerson"
            />
          </div>
        </label>
        <label className="block text-xs font-black">
          Priority
          <select
            className="mt-1.5 min-h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-sm"
            defaultValue="2"
            name="priority"
          >
            <option value="1">1 — highest</option>
            <option value="2">2 — priority</option>
            <option value="3">3 — normal</option>
            <option value="4">4 — low</option>
            <option value="5">5 — archive</option>
          </select>
        </label>
        <label className="block text-xs font-black">
          Notes
          <textarea
            className="mt-1.5 min-h-24 w-full resize-y rounded-xl border border-[var(--line)] bg-white p-3 text-sm"
            name="notes"
          />
        </label>
      </div>
      {state.error ? (
        <p
          className="mt-4 rounded-xl bg-[#fff0ec] p-3 text-xs font-bold text-[#9b3826]"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p
          className="mt-4 rounded-xl bg-[#e6f5ee] p-3 text-xs font-bold text-[var(--green)]"
          role="status"
        >
          {state.success}
        </p>
      ) : null}
      <button
        className="mt-5 min-h-11 w-full rounded-xl bg-[var(--green)] px-4 text-sm font-black text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Saving…" : "Start monitoring"}
      </button>
    </form>
  );
}
