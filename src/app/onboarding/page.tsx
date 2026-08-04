import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { completeOnboarding } from "./actions";
import { SubmitButton } from "@/components/forms/submit-button";
import { db } from "@/db/client";
import { candidateProfiles } from "@/db/schema";
import { requireOwner } from "@/lib/auth/owner";

export default async function OnboardingPage() {
  const user = await requireOwner();
  const [existing] = await db
    .select({ id: candidateProfiles.id })
    .from(candidateProfiles)
    .where(eq(candidateProfiles.userId, user.id))
    .limit(1);
  if (existing) redirect("/");
  return (
    <main className="grid min-h-screen place-items-center p-5">
      <form
        action={completeOnboarding}
        className="w-full max-w-2xl rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-xl sm:p-9"
      >
        <span className="grid size-12 place-items-center rounded-2xl bg-[var(--green)] text-xl font-black text-white">
          F
        </span>
        <p className="mt-6 text-xs font-black tracking-[0.18em] text-[var(--green)] uppercase">
          Private profile setup
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-[-0.04em]">Make every match yours.</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          These values power deterministic filtering. You can refine geography and role priorities
          in Settings.
        </p>
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          <Field label="Full name" name="fullName" required />
          <Field
            label="Headline"
            name="headline"
            placeholder="Early-career Software Engineer"
            required
          />
          <Field label="Home city" name="homeCity" required />
          <Field label="State or region" name="homeRegion" required />
          <label className="text-sm font-black">
            Full-time experience (months)
            <input
              className="mt-2 min-h-11 w-full rounded-xl border border-[var(--line)] px-3"
              min={0}
              name="monthsExperience"
              required
              type="number"
            />
          </label>
          <label className="flex min-h-11 items-center justify-between self-end rounded-xl bg-[var(--paper)] px-4 text-sm font-black">
            Need US sponsorship
            <input name="needsSponsorship" type="checkbox" />
          </label>
        </div>
        <label className="mt-4 block text-sm font-black">
          Skills
          <textarea
            className="mt-2 min-h-28 w-full rounded-xl border border-[var(--line)] p-3 text-sm font-normal"
            name="skills"
            placeholder="TypeScript, React, Python…"
          />
        </label>
        <SubmitButton
          className="mt-6 min-h-12 w-full rounded-xl bg-[var(--green)] px-5 font-black text-white"
          pendingLabel="Creating private profile…"
        >
          Complete setup
        </SubmitButton>
      </form>
    </main>
  );
}

function Field({
  label,
  name,
  placeholder,
  required = false,
}: {
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="text-sm font-black">
      {label}
      <input
        className="mt-2 min-h-11 w-full rounded-xl border border-[var(--line)] px-3"
        name={name}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}
