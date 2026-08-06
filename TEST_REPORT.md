# FirstSeen test report

Push-first local release tested 2026-08-05 on macOS with Node 22.23.2, pnpm 11.9.0,
local Supabase PostgreSQL/Auth in Docker, Next.js 16.2.12, React 19.2.8, and Inngest CLI 1.40.0.

## Local release gate

| Check                   | Verified command                             | Result                                                             |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| Formatting              | `pnpm format:check`                          | Pass; all tracked files                                            |
| Lint                    | `pnpm lint`                                  | Pass; zero warnings                                                |
| Strict TypeScript       | `pnpm typecheck`                             | Pass                                                               |
| Unit/component/contract | `pnpm test`                                  | Pass                                                               |
| PostgreSQL/Auth/RLS     | `RUN_DATABASE_TESTS=true pnpm test`          | 408 passed in 68 files                                             |
| Coverage                | `RUN_DATABASE_TESTS=true pnpm test:coverage` | 89.49% statements, 78.91% branches, 90.22% functions, 91.36% lines |
| Dependency security     | `pnpm audit --audit-level=low`               | Pass; zero known vulnerabilities                                   |
| Production compile      | `pnpm build`                                 | Pass                                                               |
| Real browser/Axe        | `pnpm test:e2e`                              | 21 passed, 3 intentional skips; retries disabled                   |

Coverage enforces at least the prior-release baseline: 87.15% statements, 77.45% branches, 88.98%
functions, and 89.21% lines. New AI escalation, global supply, CRM, application, Web Push, PWA,
discovery-security, and scheduler paths are included. Focused commands also passed: 91 connector
tests, 85 AI/eligibility tests, 59 worker/database tests, three PWA tests, 31 security tests, and two
load tests.

## Risk coverage

- Freshness boundaries at 6h, 24h, 72h, 7d, and 30d; all-window parsing; official-date default
  sorting; detection/urgency sorting; dynamic aging; ancient newly detected jobs; malformed/future
  date fallback; reliable reopening; material-update distinction; server URL persistence.
- Read-time ranking projection keeps freshness, Hot-to-Strong demotion, competition proxy, urgency,
  headline, and routing explanation synchronized as time passes without rewriting history. Queue
  cards batch-load the same stored dimensions used by details; their projected urgency values are
  covered by a database equality regression.
- Browser-fixture source policy rejects non-boolean disable flags. Real local Next.js/Inngest manual
  and scheduled scans of both fixture sources completed as observable `network_disabled` successes,
  with zero active source errors and zero unresolved dead letters.
- Independent interest/referral/scope combinations; 15/60/240-minute cadence; recent-viable Warm
  promotion; stale/ineligible/Review rejection; sticky quarantine; adaptive Cold-only slowdown.
- Full-time, required versus preferred experience, two-year maximum, clearance and equivalent
  federal suitability language,
  sponsorship, accepted-location/remote, explicit foreign-only remote, NYC-versus-NJ, and role-family
  hard rules. AI cannot override deterministic exclusion; stale policy versions cannot enter Active.
- Connector pagination, 304, malformed data, rate pacing, retries/backoff, official verification,
  safe URL/redirect/DNS/SSRF behavior, source isolation, closure/reopening, dedupe, snapshots, and
  unchanged fast path.
- Unchanged-text reopening reranks from cached AI without another OpenAI usage row; original posting
  time and queue action persist; alert identity changes only for the reopening occurrence.
- Paid Luna/Terra calls are memoized independently from database persistence. A replay after a
  simulated persistence outage reuses the provider result, and usage from an accepted but
  schema-invalid first response remains included when validation succeeds on the second response.
- Push Policy V2 presets, exact six/24-hour boundaries, role/relationship promotion, company
  Always/Mute, official/reopening time, Review and action suppression, quiet-hour/DST deferral and
  wake-up re-evaluation, stable occurrence identity, replay safety, per-device privacy, six-per-hour
  overflow coalescing, retry/exhaustion/404/410 cleanup, and preview/evaluator equivalence.
- Four-digit sign-in failure/success/sign-out, durable throttling, owner authorization, anon and
  cross-user RLS denial, CSRF/input validation, export, settings, and queue persistence after reload.
- Shared global source fetch/fan-out, oldest-due scheduling, candidate-neutral extraction reuse,
  strictest-watcher cadence propagation, private overlays, contact/referral recommendations,
  application sessions/stages/follow-ups,
  private resume policy, encrypted push subscriptions, channel/device deduplication, and service
  worker lifecycle/privacy.
- Structured-source URL authority, `validThrough` closure, bounded sitemap patterns, compressed IPv6
  loopback rejection, nullable notification-preference uniqueness, and concurrent push registration.
- Slack/Web Push bounded exhaustion, permanent rejection, normal 410 cleanup, redacted dead-letter
  creation, explicit replay, successful resolution, and at-most-once handling for stale unknown
  provider outcomes.

## Browser matrix

| Viewport  | Access gate | Fresh feed/actions | Companies/core routes/Axe | Visual capture |
| --------- | ----------- | ------------------ | ------------------------- | -------------- |
| 390×844   | Pass        | Pass               | Pass                      | Pass           |
| 768×1024  | Pass        | Pass               | Pass                      | Pass           |
| 1440×900  | Pass        | Pass               | Pass                      | Pass           |
| 1920×1080 | Pass        | Pass               | Pass                      | Pass           |

Observers fail on page exceptions, browser console errors, unexpected failed responses, and HTTP
5xx responses. The suite
exercised URL-restored filters, official-apply redirect, Save/Applied/Dismiss/Restore persistence,
interest/referral cadence changes, add/remove company recovery, confirmation focus, every core
route, notification presets/customization/preview/company overrides, feed settings, account export,
relationship capture, application-session return, stage changes, follow-up scheduling, and reload
persistence. No page failure or Axe violation remained.

## Real runtime and provider evidence

| Provider/path | 2026-08-04 result                                                              |
| ------------- | ------------------------------------------------------------------------------ |
| Greenhouse    | 176 public Figma listings; sample officially verified open                     |
| Lever         | 100 public Palantir listings; pagination present; sample verified open         |
| Ashby         | 25 public Linear listings; sample verified open                                |
| Recruitee     | amperecloud 5/open and xneelo 3/open                                           |
| Pinpoint      | workwithus 3/open and wealthwizards 3/open                                     |
| Safety bound  | TransPerfect's >8 MiB response rejected with `RESPONSE_TOO_LARGE`              |
| Brave Search  | 6 candidates; all 6 directly resolvable supported official URLs                |
| Adzuna        | Disabled provider was not instantiated or contacted                            |
| OpenAI        | `gpt-5.6-luna` structured evidence passed; 1,204 input and 1,139 output tokens |
| Slack         | Labelled setup check delivered, HTTP 200                                       |
| Inngest       | Prior real Figma source run succeeded; duplicate delivery safe                 |

The real local Inngest source event fetched and finalized 176 official Greenhouse listings with one
succeeded source run, zero source errors, and zero unresolved dead letters. Delivering the identical
stable scan occurrence again retained exactly one `scan_runs` row; its source attempt was safely
reconciled and no dead letter appeared. Application callbacks were HTTP 200/206 and completed within
the configured hosted-function bounds.

The protected production roles/schema/data backup restored into a separately named disposable
local database after bootstrapping Supabase-managed Auth/Storage definitions. Aggregate validation
found 33 public tables, one Auth user, 37 companies, 2,368 jobs, 2,828 snapshots and eligibility
decisions, 5,890 recommendations, 71 queue states, and zero unvalidated constraints. The disposable
database was then deleted; the protected backup remained unchanged.

## Production status

- Additive Daily-Driver migrations through `20260804162800_notification_preference_integrity.sql`
  applied to the guarded FirstSeen database URL. `pnpm verify:production-schema` returned `ok: true`:
  55 organizations, 56 global sources, zero listed private tables without RLS, no Auth/anon read
  privilege on global raw observations or the global outbox, and the latest migration/indexes present.
- Protected non-empty roles/schema/data backup artifacts were created outside the repository before
  applying the backward-compatible migration to dedicated FirstSeen ref `tlhwxayhjamopnnlroke`.
- Company, feed, Slack, shared supply, CRM, application, PWA, and Web Push rollout flags were deployed
  to the Ready canonical remote build. Inngest successfully registered the release after total
  concurrency was bounded to the active plan limit.
- Current-policy targeted replay accepted 72 active queue occurrences. Final aggregate health showed
  52 active official sources, 2,933 open global jobs, 2,681 open private jobs, 57 successful global
  scans in two hours, and zero active-source errors, unresolved dead letters, recent worker failures,
  failed deliveries, or global/private outbox backlog.
- The authenticated default seven-day feed showed nine current-policy jobs in New and Recent sections.
  The foreign-only Sweden regression is absent from the queue.
- Authenticated browser inspection at all four required viewports found no overflow or warning/error
  console output. The final canonical remote deployment had no HTTP 5xx log entries in the inspected
  45-minute window.
- Slack delivered the 2026-08-04 digest once at 8:00:04 AM Eastern with eight jobs, with no duplicate
  idempotency groups or failed notifications.

The unrelated ProofCheck project remained out of scope and was not mutated.

## Certification limits

This report does not claim a seven-day Push-only production soak, physical iPhone Web Push,
300 human-labeled AI evaluations, an 85% independent-market recall result, a licensed-sensor
bakeoff, or external multi-user launch. Those remain explicit gates in
`PLAN.md`; automated Chromium and fixture tests are not represented as substitutes.
