import { eq } from "drizzle-orm";
import Link from "next/link";
import { deleteAccount, updateNotifications } from "./actions";
import { ConfirmSubmit } from "@/components/forms/confirm-submit";
import { db } from "@/db/client";
import { candidateProfiles, searchPreferences } from "@/db/schema";
import { requireOwner } from "@/lib/auth/owner";
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const owner = await requireOwner();
  const query = await searchParams;
  const [profile] = await db
    .select()
    .from(candidateProfiles)
    .where(eq(candidateProfiles.userId, owner.id))
    .limit(1);
  const [prefs] = await db
    .select()
    .from(searchPreferences)
    .where(eq(searchPreferences.userId, owner.id))
    .limit(1);
  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <p className="text-xs font-black tracking-[0.18em] text-[var(--green)] uppercase">
          Candidate controls
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-[-0.04em]">Settings</h1>
      </header>
      {query.saved === "1" ? (
        <p
          className="mt-5 rounded-xl border border-[var(--green)] bg-[var(--surface)] p-3 text-sm font-bold text-[var(--green)]"
          role="status"
        >
          Notification settings saved.
        </p>
      ) : null}
      <section className="mt-8 rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-6">
        <h2 className="text-lg font-black">Candidate profile</h2>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-black">Name</dt>
            <dd className="mt-1 text-[var(--muted)]">{profile?.fullName}</dd>
          </div>
          <div>
            <dt className="font-black">Full-time experience</dt>
            <dd className="mt-1 text-[var(--muted)]">{profile?.monthsFullTimeExperience} months</dd>
          </div>
          <div>
            <dt className="font-black">Sponsorship</dt>
            <dd className="mt-1 text-[var(--muted)]">Not needed</dd>
          </div>
          <div>
            <dt className="font-black">Maximum required experience</dt>
            <dd className="mt-1 text-[var(--muted)]">{prefs?.eligibleRequiredYearsMax} years</dd>
          </div>
        </dl>
        <p className="mt-5 rounded-xl bg-[var(--paper)] p-3 text-xs leading-5 text-[var(--muted)]">
          Hard filters are versioned in code and cannot be weakened by AI analysis.
        </p>
      </section>
      <form
        action={updateNotifications}
        className="mt-6 rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-6"
      >
        <h2 className="text-lg font-black">Slack notifications</h2>
        <div className="mt-5 space-y-4">
          <label className="flex items-center justify-between gap-4 rounded-xl bg-[var(--paper)] p-4 text-sm font-black">
            Morning digest
            <input defaultChecked={prefs?.digestEnabled} name="digestEnabled" type="checkbox" />
          </label>
          <label className="flex items-center justify-between gap-4 rounded-xl bg-[var(--paper)] p-4 text-sm font-black">
            Exceptional-match alerts
            <input
              defaultChecked={prefs?.exceptionalAlertsEnabled}
              name="alertsEnabled"
              type="checkbox"
            />
          </label>
          <label className="block text-sm font-black">
            Digest hour (Eastern)
            <select
              className="mt-2 min-h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3"
              defaultValue={prefs?.digestHourLocal}
              name="digestHour"
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {hour.toString().padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="mt-5 min-h-11 rounded-xl bg-[var(--green)] px-5 text-sm font-black text-white"
          type="submit"
        >
          Save notification settings
        </button>
      </form>
      <section className="mt-6 rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-6">
        <h2 className="text-lg font-black">Your data</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Download a JSON copy of your profile, companies, listings, recommendations, actions,
          notification history, and operational records.
        </p>
        <Link
          className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-[var(--line)] px-4 text-sm font-black"
          href="/settings/export"
        >
          Download complete export
        </Link>
        <div className="mt-8 border-t border-[var(--line)] pt-6">
          <h3 className="font-black text-[var(--danger)]">Delete account and all data</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            This permanently deletes your sign-in and all FirstSeen data through database cascade
            rules. It cannot be undone. Download an export first if you need a copy.
          </p>
          <form action={deleteAccount} className="mt-4">
            <label className="block text-sm font-black" htmlFor="delete-confirmation">
              Type DELETE FIRSTSEEN to confirm
            </label>
            <input
              autoComplete="off"
              className="mt-2 min-h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3"
              id="delete-confirmation"
              name="confirmation"
              pattern="DELETE FIRSTSEEN"
              required
            />
            <ConfirmSubmit
              className="mt-3 min-h-11 rounded-xl bg-[var(--coral)] px-4 text-sm font-black text-[var(--ink)]"
              message="Permanently delete this account and every FirstSeen record? This cannot be undone."
              type="submit"
            >
              Permanently delete account
            </ConfirmSubmit>
          </form>
        </div>
      </section>
    </div>
  );
}
