export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-12">
      <section className="w-full rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-8 shadow-[0_24px_80px_rgb(23_35_31/0.08)] md:p-14">
        <div className="mb-10 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-[var(--green)] text-lg font-black text-white">
            F
          </span>
          <span className="text-sm font-bold tracking-[0.18em] text-[var(--green)] uppercase">
            FirstSeen
          </span>
        </div>
        <p className="mb-4 text-sm font-bold tracking-[0.16em] text-[var(--green)] uppercase">
          Direct from the source
        </p>
        <h1 className="max-w-3xl text-5xl leading-[0.95] font-black tracking-[-0.055em] md:text-7xl">
          Good jobs, while they are still fresh.
        </h1>
        <p className="mt-7 max-w-2xl text-lg leading-8 text-[var(--muted)] md:text-xl">
          FirstSeen watches official company career pages, verifies every opening, and surfaces
          early-career software roles that actually meet your constraints.
        </p>
        <div className="mt-10 flex flex-wrap gap-3 text-sm font-semibold">
          <span className="rounded-full bg-[var(--lime)] px-4 py-2">Official listings</span>
          <span className="rounded-full border border-[var(--line)] px-4 py-2">
            Hard filters first
          </span>
          <span className="rounded-full border border-[var(--line)] px-4 py-2">
            Explainable matches
          </span>
        </div>
      </section>
    </main>
  );
}
