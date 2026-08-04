"use client";

import type { ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  pendingLabel = "Working…",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button {...props} aria-disabled={pending || disabled} disabled={pending || disabled}>
      {pending ? pendingLabel : children}
    </button>
  );
}
