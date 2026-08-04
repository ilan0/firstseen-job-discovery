"use client";
import { useId, useRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";
import { SubmitButton } from "./submit-button";
export function ConfirmSubmit({
  message,
  pendingLabel = "Working…",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { message: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button
        {...props}
        aria-disabled={pending || disabled}
        disabled={pending || disabled}
        onClick={() => dialog.current?.showModal()}
        type="button"
      >
        {children}
      </button>
      <dialog
        aria-labelledby={titleId}
        className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-0 text-[var(--ink)] shadow-[0_30px_100px_rgb(8_32_25/0.3)]"
        ref={dialog}
      >
        <div className="p-6 sm:p-7">
          <h2 className="text-xl font-black tracking-[-0.025em]" id={titleId}>
            Are you sure?
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{message}</p>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button
              className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-black"
              onClick={() => dialog.current?.close()}
              type="button"
            >
              Cancel
            </button>
            <SubmitButton
              className="min-h-11 rounded-xl bg-[var(--danger)] px-4 text-sm font-black text-white"
              pendingLabel={pendingLabel}
              type="submit"
            >
              {children}
            </SubmitButton>
          </div>
        </div>
      </dialog>
    </>
  );
}
