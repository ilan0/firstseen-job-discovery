import { and, asc, desc, eq, isNull } from "drizzle-orm";
import {
  BellRing,
  Building2,
  CalendarClock,
  ExternalLink,
  MessageCircleMore,
  Network,
  UserRoundCheck,
} from "lucide-react";
import {
  addContactInteraction,
  addRelationshipReminder,
  archiveContact,
  completeRelationshipReminder,
  updateReferralStatus,
} from "./actions";
import { ContactForm } from "@/components/relationships/contact-form";
import { ConfirmSubmit } from "@/components/forms/confirm-submit";
import { SubmitButton } from "@/components/forms/submit-button";
import { db } from "@/db/client";
import {
  companies,
  contactCompanyLinks,
  contactInteractions,
  contactMethods,
  contacts,
  organizations,
  referralRequests,
  relationshipReminders,
} from "@/db/schema";
import { requireOwner } from "@/lib/auth/owner";
import { rolloutFlags } from "@/config/rollout";
import { notFound } from "next/navigation";

export default async function RelationshipsPage() {
  if (!rolloutFlags().relationshipCrm) notFound();
  const owner = await requireOwner();
  const [companyRows, people, methods, interactions, reminders, requests] = await Promise.all([
    db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(and(eq(companies.userId, owner.id), eq(companies.active, true)))
      .orderBy(asc(companies.name)),
    db
      .select({
        id: contacts.id,
        name: contacts.name,
        title: contacts.title,
        team: contacts.team,
        location: contacts.location,
        origin: contacts.relationshipOrigin,
        strength: contacts.relationshipStrength,
        notes: contacts.notes,
        company: organizations.name,
        organizationId: organizations.id,
        companyStatus: contactCompanyLinks.relationshipStatus,
      })
      .from(contacts)
      .innerJoin(contactCompanyLinks, eq(contactCompanyLinks.contactId, contacts.id))
      .innerJoin(organizations, eq(contactCompanyLinks.organizationId, organizations.id))
      .where(and(eq(contacts.userId, owner.id), eq(contacts.active, true)))
      .orderBy(asc(organizations.name), asc(contacts.name)),
    db.select().from(contactMethods).where(eq(contactMethods.userId, owner.id)),
    db
      .select()
      .from(contactInteractions)
      .where(eq(contactInteractions.userId, owner.id))
      .orderBy(desc(contactInteractions.occurredAt)),
    db
      .select()
      .from(relationshipReminders)
      .where(
        and(
          eq(relationshipReminders.userId, owner.id),
          isNull(relationshipReminders.completedAt),
          isNull(relationshipReminders.dismissedAt),
        ),
      )
      .orderBy(asc(relationshipReminders.dueAt)),
    db
      .select()
      .from(referralRequests)
      .where(eq(referralRequests.userId, owner.id))
      .orderBy(desc(referralRequests.updatedAt)),
  ]);
  const group = <T extends { contactId: string }>(values: T[]) => {
    const map = new Map<string, T[]>();
    for (const value of values)
      map.set(value.contactId, [...(map.get(value.contactId) ?? []), value]);
    return map;
  };
  const methodsByContact = group(methods);
  const interactionsByContact = group(interactions);
  const remindersByContact = group(reminders);
  const requestsByContact = group(requests);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-xs font-black tracking-[0.18em] text-[var(--green)] uppercase">
            Referral memory
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-[-0.04em]">People</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Remember who can help, when you last spoke, and the next human action. FirstSeen keeps
            the context; it never sends outreach for you.
          </p>
        </div>
        <div className="rounded-2xl bg-[var(--surface)] px-4 py-3 text-right">
          <p className="text-2xl font-black">{people.length}</p>
          <p className="text-xs font-bold text-[var(--muted)]">active relationships</p>
        </div>
      </header>
      <div className="mt-8 grid items-start gap-7 lg:grid-cols-[22rem_1fr]">
        <div className="lg:sticky lg:top-7">
          <ContactForm companies={companyRows} />
          <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 text-xs leading-5 text-[var(--muted)]">
            <Network aria-hidden="true" className="mr-1 inline text-[var(--green)]" size={15} />
            Strong current relationships and recent interactions are recommended first. A referral
            status never changes your hard job eligibility.
          </div>
        </div>
        <section aria-live="polite">
          <h2 className="sr-only">Saved people</h2>
          {people.length ? (
            <div className="space-y-4">
              {people.map((person) => {
                const personMethods = methodsByContact.get(person.id) ?? [];
                const personInteractions = interactionsByContact.get(person.id) ?? [];
                const personReminders = remindersByContact.get(person.id) ?? [];
                const personRequests = requestsByContact.get(person.id) ?? [];
                const currentRequest = personRequests[0];
                return (
                  <article
                    className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6"
                    key={`${person.id}:${person.organizationId}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-black">{person.name}</h3>
                          <span className="rounded-full bg-[#eee9ff] px-2.5 py-1 text-[0.68rem] font-black text-[#54379a] uppercase">
                            Strength {person.strength}/5
                          </span>
                          {currentRequest ? (
                            <span className="rounded-full bg-[#e7f6ef] px-2.5 py-1 text-[0.68rem] font-black text-[var(--green)] uppercase">
                              Referral {currentRequest.status}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 flex items-center gap-1.5 text-sm font-bold">
                          <Building2 aria-hidden="true" size={15} /> {person.company} ·{" "}
                          {person.companyStatus}
                        </p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {[person.title, person.team, person.location]
                            .filter(Boolean)
                            .join(" · ") || "Role details not added"}
                        </p>
                        {person.origin ? (
                          <p className="mt-2 text-xs text-[var(--muted)]">
                            How you know them: {person.origin}
                          </p>
                        ) : null}
                      </div>
                      <form action={archiveContact}>
                        <input name="contactId" type="hidden" value={person.id} />
                        <ConfirmSubmit
                          className="text-xs font-black text-[var(--danger)]"
                          message={`Archive ${person.name}? Their history will be retained.`}
                          pendingLabel="Archiving…"
                        >
                          Archive
                        </ConfirmSubmit>
                      </form>
                    </div>
                    {personMethods.length ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {personMethods.map((method) => {
                          const href =
                            method.kind === "email"
                              ? `mailto:${method.value}`
                              : method.kind === "phone"
                                ? `tel:${method.value}`
                                : method.kind === "profile_url"
                                  ? method.value
                                  : null;
                          return href ? (
                            <a
                              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[var(--paper)] px-3 text-xs font-black text-[var(--green)]"
                              href={href}
                              key={method.id}
                              rel="noreferrer"
                              target={method.kind === "profile_url" ? "_blank" : undefined}
                            >
                              {method.label || method.kind.replaceAll("_", " ")}{" "}
                              <ExternalLink size={13} />
                            </a>
                          ) : (
                            <span
                              className="rounded-xl bg-[var(--paper)] px-3 py-2 text-xs"
                              key={method.id}
                            >
                              {method.value}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                    {person.notes ? (
                      <p className="mt-4 rounded-xl bg-[var(--paper)] p-3 text-sm leading-6">
                        {person.notes}
                      </p>
                    ) : null}
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <section className="rounded-2xl border border-[var(--line)] p-4">
                        <h4 className="flex items-center gap-2 text-sm font-black">
                          <BellRing aria-hidden="true" size={16} /> Next action
                        </h4>
                        {personReminders.map((reminder) => (
                          <div className="mt-3 text-xs" key={reminder.id}>
                            <p className="font-black">{reminder.nextAction}</p>
                            <p className="mt-1 text-[var(--muted)]">
                              Due {reminder.dueAt.toLocaleDateString()}
                            </p>
                            <form action={completeRelationshipReminder}>
                              <input name="reminderId" type="hidden" value={reminder.id} />
                              <SubmitButton
                                className="mt-2 font-black text-[var(--green)]"
                                pendingLabel="Completing…"
                              >
                                Mark done
                              </SubmitButton>
                            </form>
                          </div>
                        ))}
                        <form action={addRelationshipReminder} className="mt-3 grid gap-2">
                          <input name="contactId" type="hidden" value={person.id} />
                          <input
                            aria-label={`Reminder action for ${person.name}`}
                            className="min-h-10 rounded-xl border border-[var(--line)] px-3 text-xs"
                            maxLength={500}
                            name="nextAction"
                            placeholder="Follow up about referral"
                            required
                          />
                          <input
                            aria-label={`Reminder date for ${person.name}`}
                            className="min-h-10 rounded-xl border border-[var(--line)] px-3 text-xs"
                            name="dueDate"
                            required
                            type="date"
                          />
                          <SubmitButton
                            className="min-h-10 rounded-xl bg-[var(--paper)] px-3 text-xs font-black"
                            pendingLabel="Scheduling…"
                          >
                            Schedule reminder
                          </SubmitButton>
                        </form>
                      </section>
                      <section className="rounded-2xl border border-[var(--line)] p-4">
                        <h4 className="flex items-center gap-2 text-sm font-black">
                          <UserRoundCheck aria-hidden="true" size={16} /> Referral status
                        </h4>
                        {currentRequest ? (
                          <form action={updateReferralStatus} className="mt-3 flex gap-2">
                            <input name="requestId" type="hidden" value={currentRequest.id} />
                            <select
                              aria-label={`Referral status with ${person.name}`}
                              className="min-h-10 min-w-0 flex-1 rounded-xl border border-[var(--line)] px-2 text-xs"
                              defaultValue={currentRequest.status}
                              name="status"
                            >
                              {[
                                "available",
                                "requested",
                                "agreed",
                                "submitted",
                                "declined",
                                "expired",
                                "completed",
                              ].map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                            <SubmitButton
                              className="min-h-10 rounded-xl bg-[var(--green)] px-3 text-xs font-black text-white"
                              pendingLabel="Saving…"
                            >
                              Save
                            </SubmitButton>
                          </form>
                        ) : (
                          <p className="mt-3 text-xs text-[var(--muted)]">
                            Not marked as a referral contact.
                          </p>
                        )}
                        <h4 className="mt-5 flex items-center gap-2 text-sm font-black">
                          <MessageCircleMore aria-hidden="true" size={16} /> Interaction
                        </h4>
                        {personInteractions[0] ? (
                          <div className="mt-2 text-xs">
                            <p className="font-black">{personInteractions[0].summary}</p>
                            <p className="mt-1 text-[var(--muted)]">
                              {personInteractions[0].occurredAt.toLocaleDateString()} ·{" "}
                              {personInteractions[0].interactionType}
                            </p>
                          </div>
                        ) : null}
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs font-black text-[var(--green)]">
                            Log interaction
                          </summary>
                          <form action={addContactInteraction} className="mt-3 grid gap-2">
                            <input name="contactId" type="hidden" value={person.id} />
                            <input
                              aria-label={`Interaction type with ${person.name}`}
                              className="min-h-10 rounded-xl border border-[var(--line)] px-3 text-xs"
                              name="interactionType"
                              placeholder="Call, message, coffee…"
                              required
                            />
                            <textarea
                              aria-label={`Interaction summary with ${person.name}`}
                              className="min-h-20 rounded-xl border border-[var(--line)] p-3 text-xs"
                              name="summary"
                              placeholder="What happened?"
                              required
                            />
                            <SubmitButton
                              className="min-h-10 rounded-xl bg-[var(--paper)] px-3 text-xs font-black"
                              pendingLabel="Logging…"
                            >
                              Log interaction
                            </SubmitButton>
                          </form>
                        </details>
                      </section>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[1.5rem] border border-dashed border-[var(--line)] bg-[var(--surface)] px-6 py-16 text-center">
              <CalendarClock aria-hidden="true" className="mx-auto text-[var(--green)]" size={30} />
              <p className="mt-4 font-black">No relationships captured yet</p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Add the first person on the left. Three fields are enough.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
