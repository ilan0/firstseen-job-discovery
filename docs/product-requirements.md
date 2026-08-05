# FirstSeen product requirements

## Outcome

FirstSeen minimizes the time between a suitable entry-level software-engineering vacancy becoming
public on an official employer site and Ilan seeing and applying to it. The default experience is a
never-ending, fresh queue that is easy to clear with Apply, Save, and Dismiss; exceptional matches
arrive immediately in Slack and the best remaining work arrives in a morning digest.

The release remains a private personal product. Its data model and authentication foundations are
commercial-ready and per-user, but external invitations and public signup stay disabled until the
licensing, SMTP, legal, paid-capacity, and privacy prerequisites in `PLAN.md` are met. Fit matters
more than ordering Miami, DMV, New York, and remote against one another, and application volume is
not artificially capped.

## Candidate profile

- Ilan Nabatkhorian is a US/French citizen who does not require US sponsorship.
- Eight months of full-time software-engineering experience.
- Full-time employment only. Any salary and industry are acceptable.
- Required experience of zero to one year is ideal; more than two required years is ineligible.
  Preferred experience does not become a hard exclusion.
- Any current clearance, ability/eligibility to obtain one, or equivalent federal suitability
  requirement is ineligible. An ordinary background check is not a clearance.
- Onsite/hybrid eligibility: within approximately one hour of Miami in South Florida; within
  approximately one hour of Fairfax, Virginia in the DMV; or inside New York City's five boroughs.
  New Jersey is excluded from the NYC rule.
- Fully remote jobs are eligible when the employer can employ the candidate in an accepted US
  jurisdiction. An explicit unsupported-country/region restriction is ineligible; genuinely unclear
  state restrictions route to review.
- Role preference, in order: general SWE by a large margin, full stack, backend, frontend, AI
  engineering, embedded/C, internal tools/automation, and customer-facing engineering. Lower
  preference is not automatic ineligibility.
- Resume evidence and skills are persisted in the owner candidate profile; security-sensitive or
  unsupported assumptions are not inferred from a title.

## Discovery and freshness

- The owner can add a company, official career URL, referral person, priority, status, and notes
  with minimal friction.
- Company interest and referrals are independent. My Companies contains intentionally followed
  companies; automatic discoveries remain in Discovered Companies with provider provenance.
- Interested or active-referral companies scan every 15 minutes; other followed and warm discovered
  companies scan hourly; cold discovered companies scan every four hours. Sticky dismissal
  quarantines a source. Adaptive cadence may slow only cold automatic sources.
- Broad discovery runs all twelve role/location cohorts every four hours. Brave is a transient URL
  sensor, never an authority. Adzuna automated promotion stays disabled until written permission
  permits offsite official verification.
- Every recommended listing must be verified through an official supported employer/ATS URL.
- The official listing description, not an aggregator snippet or seniority label, determines fit.
- Persist posted, first-seen, verified, last-seen, changed, possibly-closed, closed, and reopened
  times. Deprioritize aging jobs and avoid stale/duplicate recommendations.
- Hash material fields and analyze only new/materially changed descriptions. Conditional requests
  skip unchanged source responses.
- Closure requires successful authoritative misses according to connector policy. A failed source
  scan is never closure evidence.
- A broadly discovered company becomes Warm only after a verified eligible Hot, Strong, or Possible
  role no older than seven days. Irrelevant, excluded, Review-only, or stale roles cannot promote it.
- Freshness has one shared dynamic policy. The default feed is official postings no older than seven
  days, grouped into Just posted (0–24h), New (1–3d), and Recent (3–7d). Hot/Strong postings from
  7–30 days appear only as Older exceptional matches; older jobs remain in All listings/history.
- Cards/details distinguish official posting, FirstSeen detection, and last official verification.
  Low-confidence or anomalous official timestamps visibly fall back to first verified sighting.
  Reopening is fresh from `reopened_at` without replacing the original posting date; material edits
  receive Updated and do not become newly posted.

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
- Immediate Slack alerts are reserved for verified Hot or Strong matches under 24 hours old, or a
  newly verified reopening, with urgency at least 85 and reliable time provenance. Morning digest
  includes only unacted jobs detected since the prior digest and no older than seven days, grouped
  by age; an empty digest is skipped. Delivery uses an exact configured hour and IANA time zone, is
  idempotent, and respects quiet hours.

## Daily-driver workflows

- Supply-side organizations, sources, observations, jobs, snapshots, lifecycle, and
  candidate-neutral requirement extraction are canonical and shared. Candidate profiles, company
  follows, eligibility, ranking, queue actions, contacts, applications, resumes, and notification
  devices are private overlays.
- Greenhouse, Lever, Ashby, Recruitee, Pinpoint, and reviewed structured employer sources use
  documented public mechanisms. Unsupported ATS families remain explicit coverage blind spots;
  FirstSeen never substitutes an undocumented private endpoint.
- Relationship CRM stores contacts, contact methods, company links, interaction history, referral
  requests, and follow-up reminders. It recommends the best contact deterministically and provides
  copy/contact actions, but never sends outreach.
- Apply opens the verified official application and records an application session only. The user
  explicitly confirms submission before an application exists. Applications track a deliberately
  small stage set, follow-ups, resume version, referral use, notes, and outcome history.
- A private application packet exposes signed resume download and copyable facts/links/projects.
  Continue Later/Desktop bridges mobile to a user-controlled desktop application flow.
- FirstSeen is installable as a PWA. Its service worker caches only the public static shell and an
  offline fallback, never authenticated HTML/API data, contacts, resumes, or application records.
- A logical notification can deliver independently through Slack and standards-based Web Push.
  Push subscriptions are encrypted; generic lock-screen text is the default; device/channel
  deliveries are independently idempotent and retryable.
- Routine AI extraction uses explicit Luna without candidate/contact/application PII. Selective
  Terra escalation handles validated hard-field ambiguity within a deterministic budget cap. Hard
  decisions, queue routing, lifecycle, and notification eligibility remain code-owned.

## Interface

- Private four-digit access-code sign-in that creates a normal authorized owner session; disabled
  invite-only individual email foundations for a future external beta;
  responsive behavior at phone, tablet, laptop, and large desktop sizes.
- Active matches, Saved, Applications, Dismissed, job details, companies, People/Referrals,
  Operations health, notification/candidate settings, export, and deletion.
- Search/filter/sort, posted windows (6h/24h/3d/7d/30d/All), referral and band filters, official verification, scan freshness, worker
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

No full auto-application, Gmail integration, automated referral outreach, authenticated LinkedIn,
Indeed, Glassdoor, or Simplify-board automation/scraping, CAPTCHA circumvention, private/hidden ATS
API use, clearance jobs, broad recruiting CRM, automated application submission, or email-driven
applicant tracking. The application workflow remains a small explicit stage/history layer.

## Initial service targets

- Dashboard server response: p95 under 1.5 seconds; queue interaction perceived acknowledgement
  under 300 ms.
- Priority source discovery-to-feed p95 under 20 minutes; standard monitoring under 75 minutes under
  normal provider conditions.
- Exceptional enabled-channel alert within five minutes after recommendation; morning digest by
  08:02 local.
- Each durable listing step remains below the host's 60-second Hobby invocation ceiling; network
  calls have explicit shorter timeouts.
- Filtering 1,000 normalized roles in deterministic code under 250 ms in isolation.
