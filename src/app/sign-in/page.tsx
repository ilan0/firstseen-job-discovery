import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentOwner } from "@/lib/auth/owner";
import { SignInForm } from "./sign-in-form";
import { EmailSignInForm } from "./email-sign-in-form";
import { rolloutFlags } from "@/config/rollout";
import { safeAppPath } from "@/lib/security/app-path";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  if (await currentOwner()) redirect("/");
  const flags = rolloutFlags();
  const params = await searchParams;
  const requestedNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = safeAppPath(requestedNext) ?? "/";

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <section className="w-full max-w-md rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-7 shadow-[0_24px_80px_rgb(23_35_31/0.1)] sm:p-10">
        <div className="grid size-12 place-items-center rounded-2xl bg-[var(--green)] text-xl font-black text-white">
          F
        </div>
        <p className="mt-7 text-xs font-bold tracking-[0.18em] text-[var(--green)] uppercase">
          FirstSeen private portal
        </p>
        <h1 className="mt-3 text-4xl font-black tracking-[-0.045em]">Welcome back.</h1>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          Sign in to review fresh, officially verified opportunities.
        </p>
        {flags.individualAuth ? <EmailSignInForm next={next} /> : null}
        {flags.individualAuth && flags.ownerCodeAuth ? (
          <div className="my-7 flex items-center gap-3 text-xs font-bold text-[var(--muted)]">
            <span className="h-px flex-1 bg-[var(--line)]" />
            Owner access
            <span className="h-px flex-1 bg-[var(--line)]" />
          </div>
        ) : null}
        {flags.ownerCodeAuth ? <SignInForm next={next} /> : null}
      </section>
    </main>
  );
}
