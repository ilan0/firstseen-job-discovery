export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-5xl">
      <div className="h-4 w-32 animate-pulse rounded bg-[var(--line)]" />
      <div className="mt-4 h-11 w-72 max-w-full animate-pulse rounded-xl bg-[var(--line)]" />
      <div className="mt-8 space-y-4">
        <div className="h-48 animate-pulse rounded-[1.5rem] bg-[var(--surface)]" />
        <div className="h-48 animate-pulse rounded-[1.5rem] bg-[var(--surface)]" />
      </div>
      <span className="sr-only">Loading workspace</span>
    </div>
  );
}
