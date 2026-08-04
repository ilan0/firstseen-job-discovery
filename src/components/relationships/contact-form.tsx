"use client";

import { useActionState } from "react";
import { createContact, type ContactFormState } from "@/app/(app)/relationships/actions";
import { SubmitButton } from "@/components/forms/submit-button";

const initialState: ContactFormState = {};

export function ContactForm({ companies }: { companies: Array<{ id: string; name: string }> }) {
  const [state, action] = useActionState(createContact, initialState);
  return (
    <form action={action} className="rounded-[1.5rem] bg-[var(--green-dark)] p-5 text-white sm:p-6">
      <p className="text-xs font-black tracking-[0.16em] text-[var(--lime)] uppercase">
        Quick capture
      </p>
      <h2 className="mt-2 text-2xl font-black tracking-[-0.03em]">Add a person</h2>
      <p className="mt-2 text-xs leading-5 text-white/65">
        Name, company, and relationship strength are enough. You can enrich the relationship later.
      </p>
      <div className="mt-5 grid gap-3">
        <Field label="Name" name="name" placeholder="Jordan Lee" required />
        <label className="grid gap-1 text-xs font-black">
          Company
          <select
            className="min-h-11 rounded-xl border border-white/15 bg-white px-3 text-sm text-[var(--ink)]"
            name="companyId"
            required
          >
            <option value="">Choose company</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title" name="title" placeholder="Software Engineer" />
          <Field label="Team" name="team" placeholder="Platform" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-xs font-black">
            Relationship
            <select
              className="min-h-11 rounded-xl border border-white/15 bg-white px-3 text-sm text-[var(--ink)]"
              defaultValue="3"
              name="relationshipStrength"
            >
              <option value="1">1 · New</option>
              <option value="2">2 · Familiar</option>
              <option value="3">3 · Warm</option>
              <option value="4">4 · Strong</option>
              <option value="5">5 · Close</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-black">
            Company link
            <select
              className="min-h-11 rounded-xl border border-white/15 bg-white px-3 text-sm text-[var(--ink)]"
              defaultValue="current"
              name="relationshipStatus"
            >
              <option value="current">Works there now</option>
              <option value="past">Worked there before</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <label className="grid gap-1 text-xs font-black">
            Contact type
            <select
              className="min-h-11 rounded-xl border border-white/15 bg-white px-3 text-sm text-[var(--ink)]"
              name="methodKind"
            >
              <option value="">None yet</option>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="profile_url">Profile URL</option>
              <option value="other">Other</option>
            </select>
          </label>
          <Field label="Contact value" name="methodValue" placeholder="email or https://…" />
        </div>
        <Field label="How you know them" name="relationshipOrigin" placeholder="Former teammate" />
        <label className="flex min-h-11 items-center gap-2 rounded-xl bg-white/8 px-3 text-sm font-black">
          <input
            className="size-4 accent-[var(--lime)]"
            defaultChecked
            name="canRefer"
            type="checkbox"
          />
          This person may be able to refer me
        </label>
        <label className="grid gap-1 text-xs font-black">
          Notes
          <textarea
            className="min-h-20 rounded-xl border border-white/15 bg-white p-3 text-sm text-[var(--ink)]"
            maxLength={2000}
            name="notes"
            placeholder="Context worth remembering"
          />
        </label>
      </div>
      {state.error ? (
        <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-800" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p
          className="mt-4 rounded-xl bg-lime-50 p-3 text-xs font-bold text-green-900"
          role="status"
        >
          {state.success}
        </p>
      ) : null}
      <SubmitButton
        className="mt-5 min-h-11 w-full rounded-xl bg-[var(--lime)] px-4 text-sm font-black text-[var(--ink)]"
        pendingLabel="Adding person…"
      >
        Add person
      </SubmitButton>
    </form>
  );
}

function Field({
  label,
  name,
  placeholder,
  required = false,
}: {
  label: string;
  name: string;
  placeholder: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1 text-xs font-black">
      {label}
      <input
        className="min-h-11 rounded-xl border border-white/15 bg-white px-3 text-sm text-[var(--ink)]"
        maxLength={500}
        name={name}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}
