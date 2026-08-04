import { and, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { deleteAccount, updateCandidateSettings, updateNotifications } from "./actions";
import { ConfirmSubmit } from "@/components/forms/confirm-submit";
import { SubmitButton } from "@/components/forms/submit-button";
import { db } from "@/db/client";
import { candidateProfiles, searchPreferences } from "@/db/schema";
import { requireOwner } from "@/lib/auth/owner";
import { PushSettings } from "@/components/notifications/push-settings";
import { notificationChannels, notificationPreferences } from "@/db/schema";
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
  const [pushPreference] = await db
    .select({ detailed: notificationPreferences.detailedLockScreen })
    .from(notificationPreferences)
    .innerJoin(notificationChannels, eq(notificationPreferences.channelId, notificationChannels.id))
    .where(
      and(
        eq(notificationPreferences.userId, owner.id),
        eq(notificationChannels.kind, "web_push"),
        isNull(notificationPreferences.organizationId),
      ),
    )
    .limit(1);
  const acceptedAreas = Array.isArray(prefs?.acceptedAreas)
    ? (prefs.acceptedAreas as Array<{ id?: string }>).map((area) => area.id)
    : [];
  const rolePriorities = new Map(
    Array.isArray(prefs?.rolePriorities)
      ? (prefs.rolePriorities as Array<{ family: string; priority: number }>).map((role) => [
          role.family,
          role.priority,
        ])
      : [],
  );
  const skillsObject = profile?.skills as
    { languages?: string[]; frameworksAndData?: string[]; aiAndTools?: string[] } | undefined;
  const skills = [
    ...(skillsObject?.languages ?? []),
    ...(skillsObject?.frameworksAndData ?? []),
    ...(skillsObject?.aiAndTools ?? []),
  ];
  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <p className="text-xs font-black tracking-[0.18em] text-[var(--green)] uppercase">
          Candidate controls
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-[-0.04em]">Settings</h1>
      </header>
      {query.saved ? (
        <p
          className="mt-5 rounded-xl border border-[var(--green)] bg-[var(--surface)] p-3 text-sm font-bold text-[var(--green)]"
          role="status"
        >
          {query.saved === "profile" ? "Candidate settings saved." : "Notification settings saved."}
        </p>
      ) : null}
      <form
        action={updateCandidateSettings}
        className="mt-8 rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-6"
      >
        <h2 className="text-lg font-black">Candidate profile</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          These persisted values drive deterministic eligibility and ranking for your account.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-black">
            Full-time experience (months)
            <input
              className="mt-2 min-h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3"
              defaultValue={profile?.monthsFullTimeExperience}
              min={0}
              name="monthsExperience"
              required
              type="number"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-[var(--paper)] p-4 text-sm font-black">
            Need US sponsorship
            <input
              defaultChecked={profile?.needsUsSponsorship}
              name="needsSponsorship"
              type="checkbox"
            />
          </label>
          <label className="text-sm font-black">
            Ideal required years maximum
            <input
              className="mt-2 min-h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3"
              defaultValue={prefs?.idealRequiredYearsMax}
              min={0}
              name="idealYearsMax"
              required
              type="number"
            />
          </label>
          <label className="text-sm font-black">
            Eligible required years maximum
            <input
              className="mt-2 min-h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3"
              defaultValue={prefs?.eligibleRequiredYearsMax}
              min={0}
              name="eligibleYearsMax"
              required
              type="number"
            />
          </label>
        </div>
        <fieldset className="mt-5">
          <legend className="text-sm font-black">Hard constraints</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Check
              label="Full-time only"
              name="fullTimeOnly"
              checked={prefs?.fullTimeOnly ?? true}
            />
            <Check
              label="Exclude clearance"
              name="rejectClearance"
              checked={prefs?.rejectClearance ?? true}
            />
            <Check
              label="Exclude Public Trust"
              name="rejectPublicTrust"
              checked={prefs?.rejectPublicTrust ?? true}
            />
          </div>
        </fieldset>
        <fieldset className="mt-5">
          <legend className="text-sm font-black">Accepted work locations</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Check
              label="Miami / South Florida · 60 min"
              name="southFlorida"
              checked={acceptedAreas.includes("south-florida")}
            />
            <Check
              label="DMV from Fairfax · 60 min"
              name="dmv"
              checked={acceptedAreas.includes("dmv")}
            />
            <Check
              label="New York City · no New Jersey"
              name="nyc"
              checked={acceptedAreas.includes("nyc")}
            />
            <Check
              label="Fully remote US-compatible"
              name="allowRemote"
              checked={prefs?.allowFullyRemote ?? true}
            />
          </div>
        </fieldset>
        <label className="mt-5 block text-sm font-black">
          Skills used for fit explanations
          <textarea
            className="mt-2 min-h-28 w-full rounded-xl border border-[var(--line)] bg-white p-3 text-sm font-normal leading-6"
            defaultValue={skills.join(", ")}
            name="skills"
          />
        </label>
        <fieldset className="mt-5">
          <legend className="text-sm font-black">Role priorities · 1 is highest</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {[
              "general_swe",
              "full_stack",
              "backend",
              "frontend",
              "ai_engineering",
              "embedded",
              "internal_automation",
              "customer_facing",
            ].map((family, index) => (
              <label
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-3 text-xs font-black"
                key={family}
              >
                {family.replaceAll("_", " ")}
                <input
                  aria-label={`${family} priority`}
                  className="w-16 rounded-lg border border-[var(--line)] px-2 py-1"
                  defaultValue={rolePriorities.get(family) ?? index + 1}
                  max={20}
                  min={1}
                  name={`priority-${family}`}
                  required
                  type="number"
                />
              </label>
            ))}
          </div>
        </fieldset>
        <p className="mt-5 rounded-xl bg-[var(--paper)] p-3 text-xs leading-5 text-[var(--muted)]">
          AI can extract uncertain requirements, but it cannot override any proven hard exclusion.
        </p>
        <SubmitButton
          className="mt-5 min-h-11 rounded-xl bg-[var(--green)] px-5 text-sm font-black text-white"
          pendingLabel="Saving candidate settings…"
        >
          Save candidate settings
        </SubmitButton>
      </form>
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
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-black">
              Default posted-date window
              <select
                className="mt-2 min-h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3"
                defaultValue={prefs?.defaultPostedWindow ?? "7d"}
                name="defaultPostedWindow"
              >
                <option value="6h">6 hours</option>
                <option value="24h">24 hours</option>
                <option value="3d">3 days</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
                <option value="all">All listings</option>
              </select>
            </label>
            <label className="block text-sm font-black">
              Default match ordering
              <select
                className="mt-2 min-h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3"
                defaultValue={prefs?.defaultFeedSort ?? "posted_newest"}
                name="defaultFeedSort"
              >
                <option value="posted_newest">Official date: newest</option>
                <option value="detected_newest">FirstSeen detection</option>
                <option value="urgency">Most urgent</option>
              </select>
            </label>
          </div>
        </div>
        <SubmitButton
          className="mt-5 min-h-11 rounded-xl bg-[var(--green)] px-5 text-sm font-black text-white"
          pendingLabel="Saving…"
          type="submit"
        >
          Save notification settings
        </SubmitButton>
      </form>
      <PushSettings
        detailedByDefault={pushPreference?.detailed ?? false}
        publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
      />
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

function Check({ label, name, checked }: { label: string; name: string; checked: boolean }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-[var(--paper)] px-3 text-xs font-black">
      {label}
      <input defaultChecked={checked} name={name} type="checkbox" />
    </label>
  );
}
