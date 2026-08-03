# FirstSeen product requirements

## Outcome

FirstSeen minimizes the time between a suitable entry-level software-engineering vacancy becoming
public on an official employer site and Ilan seeing and applying to it. The default experience is a
never-ending, fresh queue that is easy to clear with Apply, Save, and Dismiss; exceptional matches
arrive immediately in Slack and the best remaining work arrives in a morning digest.

This is a private, single-user product. Fit matters more than ordering Miami, DMV, New York, and
remote against one another, and application volume is not artificially capped.

## Candidate profile

- Ilan Nabatkhorian is a US/French citizen who does not require US sponsorship.
- Eight months of full-time software-engineering experience.
- Full-time employment only. Any salary and industry are acceptable.
- Required experience of zero to one year is ideal; more than two required years is ineligible.
  Preferred experience does not become a hard exclusion.
- Any current clearance, ability/eligibility to obtain a clearance, Public Trust, or equivalent
  federal suitability requirement is ineligible. An ordinary background check is not a clearance.
- Onsite/hybrid eligibility: within approximately one hour of Miami in South Florida; within
  approximately one hour of Fairfax, Virginia in the DMV; or inside New York City's five boroughs.
  New Jersey is excluded from the NYC rule.
- Fully remote jobs are eligible when the employer can employ the candidate in an accepted US
  jurisdiction. Unclear state restrictions route to review.
- Role preference, in order: general SWE by a large margin, full stack, backend, frontend, AI
  engineering, embedded/C, internal tools/automation, and customer-facing engineering. Lower
  preference is not automatic ineligibility.
- Resume evidence and skills are persisted in the owner candidate profile; security-sensitive or
  unsupported assumptions are not inferred from a title.

## Discovery and freshness

- The owner can add a company, official career URL, referral person, priority, status, and notes
  with minimal friction.
- Referral/priority watchlists are leased every 15 minutes and scanned at their configured cadence;
  priority companies default to approximately hourly.
- Broad discovery runs every four hours initially. Brave and Adzuna are sensors, never authorities.
- Every recommended listing must be verified through an official supported employer/ATS URL.
- The official listing description, not an aggregator snippet or seniority label, determines fit.
- Persist posted, first-seen, verified, last-seen, changed, possibly-closed, closed, and reopened
  times. Deprioritize aging jobs and avoid stale/duplicate recommendations.
- Hash material fields and analyze only new/materially changed descriptions. Conditional requests
  skip unchanged source responses.
- Closure requires successful authoritative misses according to connector policy. A failed source
  scan is never closure evidence.
- A promising broadly discovered company becomes a low-priority monitored company only after an
  official role is successfully analyzed.

## Recommendations and actions

- Deterministic eligibility runs before AI. AI cannot override a hard exclusion.
- Missing or contradictory eligibility evidence routes to Review rather than an unjustified
  recommendation or exclusion.
- Maintain high-precision Hot/Strong queues and a broader Possible/Review queue; expose referral
  opportunities as a filter/context rather than duplicate jobs.
- Explain strengths, weaknesses, required experience, role family, location, freshness, official
  source, referral advantage, confidence, competition proxy, urgency, and deterministic reasons.
- Expose separate ranking dimensions and evidence; do not present an opaque master fit score.
- Apply opens the verified official application for manual completion with Simplify. Save and
  Dismiss remove the item from Active and persist it in the corresponding category. Applied,
  Saved, and Dismissed records remain visible if a job later closes.
- Immediate Slack alerts are reserved for exceptional hot matches. Morning digest delivery uses an
  exact configured hour and IANA time zone, is idempotent per local date, and respects quiet hours.

## Interface

- Secure sign-in; responsive behavior at phone, tablet, laptop, and large desktop sizes.
- Active matches, Saved, Applied, Dismissed, job details, Watchlist/Referrals, Operations health,
  Notification/Candidate settings, export, and deletion.
- Search/filter/sort, referral and band filters, official verification, scan freshness, worker
  health, quota/cost visibility, retry/dead-letter recovery, and provider diagnostics.
- Accessible labels/focus, keyboard operability, robust long descriptions, loading/empty/stale/error
  states, validation, success feedback, network recovery, and destructive confirmation.

## Security, privacy, and operations

- Supabase Auth plus independent owner checks on every server mutation and RLS on every user-owned
  table. Browser roles cannot access system rate-limit data.
- Server-only keys, secure Auth cookies, same-origin server actions, strict input/model schemas,
  sanitized content, SSRF/DNS/redirect defenses, security headers, safe logs, and HMACed throttling
  identifiers.
- Treat descriptions/pages as untrusted prompt-injection content. Structured model output is
  evidence-checked and cannot trigger tools or state transitions.
- Scheduled handlers are idempotent, duplicate-delivery safe, independently retryable, quota- and
  concurrency-limited, observable, and deployment safe. Never hold a transaction during network or
  AI calls. One source failure cannot fail other sources.
- Persist scans, source runs, observations, jobs, snapshots, fingerprints, eligibility, AI output,
  dimensions, recommendations, queue history/actions, notifications/digests, retry/dead-letter
  records, audit events, and usage/cost accounting.
- Support account JSON export and exact-confirmation deletion. Retain raw observations for 30 days;
  clean transient security counters after seven days.

## Explicit exclusions

No full auto-application, Gmail integration, automated referral outreach, authenticated LinkedIn
or Indeed automation/scraping, CAPTCHA circumvention, private/hidden API use, clearance jobs, or a
complex applicant-tracking workflow beyond Applied/Saved/Dismissed.

## Initial service targets

- Cached dashboard response: p95 under 1.5 seconds; queue action acknowledgement: p95 under 500 ms.
- Priority source discovery begins within 15 minutes of its due lease; changed-listing recommendation
  appears within 10 minutes of a successful source fetch.
- Exceptional Slack alert within five minutes after recommendation; digest within ten minutes of
  configured local hour.
- Each durable listing step remains below the host's 60-second Hobby invocation ceiling; network
  calls have explicit shorter timeouts.
- Filtering 1,000 normalized roles in deterministic code under 250 ms in isolation.
