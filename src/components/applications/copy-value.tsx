"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label={`Copy ${label}`}
      className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--line)] px-3 text-xs font-black"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }}
      type="button"
    >
      {copied ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
