"use client";
import { useActionState } from "react";
import { Building2, Link2, UserRoundPlus } from "lucide-react";
import { addWatchCompany, type WatchlistFormState } from "@/app/(app)/watchlist/actions";

const initialState: WatchlistFormState = {};
export function WatchlistForm() {
  const [state, action, pending] = useActionState(addWatchCompany, initialState);
  return (
    <form
      action={action}
      className="h-fit rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-5"
    >
      <h2 className="flex items-center gap-2 font-black">
        <Building2 aria-hidden="true" size={19} /> Add a company
      </h2>
      <div className="mt-5 space-y-4">
        <label className="block text-xs font-black">
          Company name
          <input
            className="mt-1.5 min-h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-sm"
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
