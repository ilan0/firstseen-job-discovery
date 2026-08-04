import { ArrowRight, BellRing, Building2, Radar } from "lucide-react";
import Link from "next/link";

export function EmptyDashboard() {
  return (
    <div className="space-y-7">
      <section className="overflow-hidden rounded-[2rem] bg-[var(--green-dark)] p-7 text-white md:p-10">
        <div className="grid gap-8 lg:grid-cols-[1.5fr_0.8fr] lg:items-end">
          <div>
            <p className="text-xs font-bold tracking-[0.18em] text-[var(--lime)] uppercase">
              Your active queue
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl leading-[1] font-black tracking-[-0.05em] md:text-6xl">
              Good jobs, while they are still fresh.
            </h1>
            <p className="mt-5 max-w-2xl leading-7 text-white/70">
              FirstSeen scans broadly for suitable early-career software roles, verifies them on
              official career pages, and prioritizes the companies you care about most.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--lime)] px-5 text-sm font-black text-[var(--green-dark)]"
                href="/watchlist"
              >
                Add a priority company <ArrowRight aria-hidden="true" size={17} />
              </Link>
              <Link
                className="inline-flex min-h-11 items-center rounded-xl border border-white/20 px-5 text-sm font-black text-white"
                href="/operations"
              >
                Check discovery health
              </Link>
            </div>
          </div>
          <div className="rounded-3xl border border-white/15 bg-white/8 p-5">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-2xl bg-[var(--lime)] text-[var(--green-dark)]">
                <Radar aria-hidden="true" size={20} />
              </span>
              <div>
                <p className="font-bold">Discovery status</p>
                <p className="text-sm text-white/60">Scheduled discovery is active</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="getting-started" className="grid gap-4 md:grid-cols-3">
        <h2 className="sr-only" id="getting-started">
          Getting started
        </h2>
        <StepCard
          description="Add employers you care about, especially companies where you know someone."
          icon={<Building2 aria-hidden="true" size={21} />}
          label="Add companies"
          number="01"
        />
        <StepCard
          description="FirstSeen verifies jobs against official employer or ATS listings."
          icon={<Radar aria-hidden="true" size={21} />}
          label="Scan official sources"
          number="02"
        />
        <StepCard
          description="Exceptional matches arrive immediately; the rest wait for your morning digest."
          icon={<BellRing aria-hidden="true" size={21} />}
          label="Get fresh matches"
          number="03"
        />
      </section>
    </div>
  );
}

function StepCard({
  description,
  icon,
  label,
  number,
}: {
  description: string;
  icon: React.ReactNode;
  label: string;
  number: string;
}) {
  return (
    <article className="group rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-6">
      <div className="flex items-center justify-between">
        <span className="grid size-11 place-items-center rounded-2xl bg-[var(--paper)] text-[var(--green)]">
          {icon}
        </span>
        <span className="text-xs font-black tracking-[0.14em] text-[var(--muted)]">{number}</span>
      </div>
      <h3 className="mt-6 text-xl font-black tracking-[-0.025em]">{label}</h3>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{description}</p>
      <ArrowRight
        aria-hidden="true"
        className="mt-5 text-[var(--green)] transition group-hover:translate-x-1"
        size={20}
      />
    </article>
  );
}
