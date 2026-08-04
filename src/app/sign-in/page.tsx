import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentOwner } from "@/lib/auth/owner";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await currentOwner()) redirect("/");

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
          Enter your private four-digit code to review fresh, officially verified opportunities.
        </p>
        <SignInForm />
      </section>
    </main>
  );
}
