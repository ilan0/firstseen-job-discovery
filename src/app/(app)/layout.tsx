import { CircleUserRound, LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/sign-in/actions";
import { ApplicationNavigation } from "@/components/navigation/application-navigation";
import { SubmitButton } from "@/components/forms/submit-button";
import { requireOwner } from "@/lib/auth/owner";

export default async function ApplicationLayout({ children }: { children: ReactNode }) {
  const owner = await requireOwner();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="border-b border-[var(--line)] bg-[var(--surface)] lg:sticky lg:top-0 lg:flex lg:h-screen lg:min-h-0 lg:flex-col lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-5 py-4 lg:block lg:flex-1 lg:px-5 lg:py-7">
          <Link className="flex items-center gap-3" href="/">
            <span className="grid size-10 place-items-center rounded-2xl bg-[var(--green)] font-black text-white">
              F
            </span>
            <span className="text-sm font-black tracking-[0.16em] text-[var(--green)] uppercase">
              FirstSeen
            </span>
          </Link>
          <form action={signOut} className="lg:hidden">
            <SubmitButton
              aria-label="Sign out"
              className="grid size-11 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--paper)] hover:text-[var(--green)]"
              pendingLabel="…"
              type="submit"
            >
              <LogOut aria-hidden="true" size={19} />
            </SubmitButton>
          </form>
          <div className="hidden lg:mt-10 lg:block">
            <p className="px-3 text-[0.68rem] font-bold tracking-[0.16em] text-[var(--muted)] uppercase">
              Workspace
            </p>
            <ApplicationNavigation />
          </div>
        </div>
        <ApplicationNavigation mobile />
        <div className="hidden px-5 pb-5 lg:block lg:w-[15rem]">
          <div className="rounded-2xl bg-[var(--paper)] p-3">
            <div className="flex items-center gap-3">
              <CircleUserRound aria-hidden="true" size={20} />
              <div className="min-w-0">
                <p className="truncate text-xs font-bold">{owner.email}</p>
                <p className="text-[0.68rem] text-[var(--muted)]">Private workspace</p>
              </div>
            </div>
            <form action={signOut}>
              <SubmitButton
                className="mt-3 text-xs font-bold text-[var(--green)]"
                pendingLabel="Signing out…"
                type="submit"
              >
                Sign out
              </SubmitButton>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-5 sm:px-6 lg:px-10 lg:py-9">{children}</main>
    </div>
  );
}
