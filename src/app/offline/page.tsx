import { WifiOff } from "lucide-react";
import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="max-w-md rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-8 text-center shadow-sm">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[var(--green-dark)] text-white">
          <WifiOff aria-hidden="true" size={24} />
        </span>
        <h1 className="mt-5 text-3xl font-black tracking-[-0.04em]">You’re offline</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          FirstSeen never caches your private job, referral, resume, or application data. Reconnect
          and retry to load the latest verified state.
        </p>
        <Link
          className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-[var(--green)] px-5 text-sm font-black text-white"
          href="/"
        >
          Try again
        </Link>
      </section>
    </main>
  );
}
