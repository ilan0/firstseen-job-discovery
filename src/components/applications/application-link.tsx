"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function ApplicationLink({ jobId }: { jobId: string }) {
  const router = useRouter();
  return (
    <Link
      className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--lime)] px-5 text-sm font-black text-[var(--ink)]"
      href={`/jobs/${jobId}/open`}
      onClick={() => window.setTimeout(() => router.refresh(), 800)}
      target="_blank"
    >
      Open verified official application <ArrowUpRight aria-hidden="true" size={17} />
    </Link>
  );
}
