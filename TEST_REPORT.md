# FirstSeen test report

Freshness-first release tested 2026-08-04 on macOS with Node 24.14.0, pnpm 11.9.0,
local Supabase PostgreSQL/Auth in Docker, Next.js 16.2.12, React 19.2.8, and Inngest CLI 1.40.0.

## Local release gate

| Check                   | Verified command                             | Result                                                             |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| Formatting              | `pnpm format:check`                          | Pass; all tracked files                                            |
| Lint                    | `pnpm lint`                                  | Pass; zero warnings                                                |
| Strict TypeScript       | `pnpm typecheck`                             | Pass                                                               |
| Unit/component/contract | `pnpm test`                                  | Pass                                                               |
| PostgreSQL/Auth/RLS     | `RUN_DATABASE_TESTS=true pnpm test`          | 218 passed in 25 files                                             |
| Coverage                | `RUN_DATABASE_TESTS=true pnpm test:coverage` | 87.15% statements, 77.45% branches, 88.98% functions, 89.21% lines |
| Dependency security     | `pnpm audit --audit-level=low`               | Pass; zero known vulnerabilities                                   |
| Production compile      | `pnpm build`                                 | Pass; 12 app routes plus Proxy                                     |
| Real browser/Axe        | `pnpm test:e2e`                              | 16 passed in 2.0 minutes; retries disabled                         |

Coverage excludes declarative Drizzle definitions and the outer AI-budget, notification, and scan
orchestration shells. Those paths are covered by the database, worker, and browser suites; the
policy preserves a 75% gate for executable business logic. For comparison, the untouched prior
release failed its nominal coverage command at 70.40% branches and 70.49% functions.

## Risk coverage

- Freshness boundaries at 6h, 24h, 72h, 7d, and 30d; all-window parsing; official-date default
  sorting; detection/urgency sorting; dynamic aging; ancient newly detected jobs; malformed/future
  date fallback; reliable reopening; material-update distinction; server URL persistence.
- Independent interest/referral/scope combinations; 15/60/240-minute cadence; recent-viable Warm
  promotion; stale/ineligible/Review rejection; sticky quarantine; adaptive Cold-only slowdown.
- Full-time, required versus preferred experience, two-year maximum, clearance/Public Trust,
  sponsorship, accepted-location/remote, explicit foreign-only remote, NYC-versus-NJ, and role-family
  hard rules. AI cannot override deterministic exclusion; stale policy versions cannot enter Active.
- Connector pagination, 304, malformed data, rate pacing, retries/backoff, official verification,
  safe URL/redirect/DNS/SSRF behavior, source isolation, closure/reopening, dedupe, snapshots, and
  unchanged fast path.
- Unchanged-text reopening reranks from cached AI without another OpenAI usage row; original posting
  time and queue action persist; alert identity changes only for the reopening occurrence.
- Slack reliable-time Hot/Strong selection, age grouping, safe untrusted text, quiet hours, DST,
  retry and alert/digest idempotency, empty-digest suppression, and prior-action exclusion.
- Four-digit sign-in failure/success/sign-out, durable throttling, owner authorization, anon and
  cross-user RLS denial, CSRF/input validation, export, settings, and queue persistence after reload.

## Browser matrix

| Viewport  | Access gate | Fresh feed/actions | Companies/core routes/Axe | Visual capture |
| --------- | ----------- | ------------------ | ------------------------- | -------------- |
| 390×844   | Pass        | Pass               | Pass                      | Pass           |
| 768×1024  | Pass        | Pass               | Pass                      | Pass           |
| 1440×900  | Pass        | Pass               | Pass                      | Pass           |
| 1920×1080 | Pass        | Pass               | Pass                      | Pass           |

Observers fail on page exceptions, browser console errors, and HTTP 5xx responses. The suite
exercised URL-restored filters, official-apply redirect, Save/Applied/Dismiss/Restore persistence,
interest/referral cadence changes, add/remove company recovery, confirmation focus, every core
route, settings, and account export. No page failure or Axe violation remained. Fresh screenshots
were inspected at every viewport; cards did not mislabel an initial listing as Updated.

## Real runtime and provider evidence

| Provider/path | 2026-08-04 result                                                                       |
| ------------- | --------------------------------------------------------------------------------------- |
| Greenhouse    | 176 public Figma listings; sample officially verified open                              |
| Lever         | 100 public Palantir listings; pagination present; sample verified open                  |
| Ashby         | 24 public Linear listings; sample verified open                                         |
| Brave Search  | 8 candidates; 7 directly resolvable supported official URLs                             |
| Adzuna        | Valid response; zero candidates for the narrow query                                    |
| OpenAI        | `gpt-5.6-luna` structured response/evidence passed; 1,406 input and 2,096 output tokens |
| Slack         | Labelled setup check delivered, HTTP 200                                                |
| Inngest       | Five functions registered; real Figma source run succeeded; duplicate delivery safe     |

The real local Inngest source event fetched and finalized 176 official Greenhouse listings with one
succeeded source run, zero source errors, and zero unresolved dead letters. Delivering the identical
stable scan occurrence again retained exactly one `scan_runs` row; its source attempt was safely
reconciled and no dead letter appeared. Application callbacks were HTTP 200/206 and completed within
the configured hosted-function bounds.

## Production status

- Protected non-empty roles/schema/data backup artifacts were created outside the repository before
  applying the backward-compatible migration to dedicated FirstSeen ref `tlhwxayhjamopnnlroke`.
- Company, feed, and Slack rollout flags were enabled independently. The current Vercel production
  deployment is Ready and serves the GitHub `main` release.
- Current-policy replay succeeded for all 45 active official sources. The unsupported Evenup board
  was externally confirmed closed, quarantined, and its prior dead letters resolved. Operations show
  zero unresolved dead letters and every active source Ready.
- All eight visible production matches passed direct official-page verification, including exact
  persisted official posted instants and HTTPS application URLs. The foreign-only Sweden regression
  is absent from the queue.
- Authenticated Chrome inspection found no warning/error console output. The inspected Vercel errors
  were only two pre-fix Evenup 404 traces; none occurred after quarantine deployment.
- Slack delivered the 2026-08-04 digest once at 8:00:04 AM Eastern with eight jobs, with no duplicate
  idempotency groups or failed notifications.

The unrelated ProofCheck project remained out of scope and was not mutated.
