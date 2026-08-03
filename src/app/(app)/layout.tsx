import {
  Bookmark,
  BriefcaseBusiness,
  Building2,
  CircleUserRound,
  Gauge,
  Inbox,
  Settings,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/sign-in/actions";
import { requireOwner } from "@/lib/auth/owner";

const navigation = [
  { href: "/", label: "Matches", icon: Inbox },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/applied", label: "Applied", icon: BriefcaseBusiness },
  { href: "/dismissed", label: "Dismissed", icon: XCircle },
  { href: "/watchlist", label: "Watchlist", icon: Building2 },
  { href: "/operations", label: "Health", icon: Gauge },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default async function ApplicationLayout({ children }: { children: ReactNode }) {
  const owner = await requireOwner();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="border-b border-[var(--line)] bg-[var(--surface)] lg:min-h-screen lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-5 py-4 lg:block lg:px-5 lg:py-7">
          <Link className="flex items-center gap-3" href="/">
            <span className="grid size-10 place-items-center rounded-2xl bg-[var(--green)] font-black text-white">
              F
            </span>
            <span className="text-sm font-black tracking-[0.16em] text-[var(--green)] uppercase">
              FirstSeen
            </span>
          </Link>
          <div className="hidden lg:mt-10 lg:block">
            <p className="px-3 text-[0.68rem] font-bold tracking-[0.16em] text-[var(--muted)] uppercase">
              Workspace
            </p>
            <nav aria-label="Primary" className="mt-3 space-y-1">
              {navigation.map(({ href, icon: Icon, label }) => (
                <Link
                  className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-bold transition hover:bg-[var(--paper)]"
                  href={href}
                  key={href}
                >
                  <Icon aria-hidden="true" size={18} />
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
        <nav aria-label="Primary mobile" className="grid grid-cols-4 gap-1 px-3 pb-3 lg:hidden">
          {navigation.map(({ href, icon: Icon, label }) => (
            <Link
              className="flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[0.68rem] font-bold hover:bg-[var(--paper)] sm:flex-row sm:justify-center sm:gap-2 sm:px-3 sm:text-xs"
              href={href}
              key={href}
            >
              <Icon aria-hidden="true" size={16} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="hidden px-5 lg:fixed lg:bottom-5 lg:block lg:w-[15rem]">
          <div className="rounded-2xl bg-[var(--paper)] p-3">
            <div className="flex items-center gap-3">
              <CircleUserRound aria-hidden="true" size={20} />
              <div className="min-w-0">
                <p className="truncate text-xs font-bold">{owner.email}</p>
                <p className="text-[0.68rem] text-[var(--muted)]">Private workspace</p>
              </div>
            </div>
            <form action={signOut}>
              <button className="mt-3 text-xs font-bold text-[var(--green)]" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-5 sm:px-6 lg:px-10 lg:py-9">{children}</main>
    </div>
  );
}
