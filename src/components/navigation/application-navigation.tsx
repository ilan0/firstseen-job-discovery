"use client";

import {
  Bookmark,
  BriefcaseBusiness,
  Building2,
  Gauge,
  Inbox,
  Settings,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/", label: "Matches", icon: Inbox },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/applied", label: "Applied", icon: BriefcaseBusiness },
  { href: "/dismissed", label: "Dismissed", icon: XCircle },
  { href: "/watchlist", label: "Watchlist", icon: Building2 },
  { href: "/operations", label: "Health", icon: Gauge },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function activeRoute(pathname: string, href: string) {
  return href === "/" ? pathname === "/" || pathname.startsWith("/jobs/") : pathname === href;
}

export function ApplicationNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={mobile ? "Primary mobile" : "Primary"}
      className={mobile ? "grid grid-cols-4 gap-1 px-3 pb-3 lg:hidden" : "mt-3 space-y-1"}
    >
      {navigation.map(({ href, icon: Icon, label }) => {
        const active = activeRoute(pathname, href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={
              mobile
                ? `flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[0.68rem] font-bold transition sm:flex-row sm:justify-center sm:gap-2 sm:px-3 sm:text-xs ${
                    active
                      ? "bg-[var(--green)] text-white shadow-sm"
                      : "text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]"
                  }`
                : `flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-bold transition ${
                    active ? "bg-[var(--green)] text-white shadow-sm" : "hover:bg-[var(--paper)]"
                  }`
            }
            href={href}
            key={href}
          >
            <Icon aria-hidden="true" size={mobile ? 16 : 18} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
