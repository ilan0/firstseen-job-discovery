# FirstSeen implementation plan and evidence

Approved 2026-08-03. The implementation and dedicated production database foundation are complete;
production deployment is held only by the remaining external account blockers below. This file
records objective evidence rather than anticipated progress.

|   # | Milestone                                         | Status                           | Exit evidence                                                                                                                  |
| --: | ------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
|   1 | Project foundation and living specification       | Complete                         | Clean Next/TypeScript/pnpm foundation, Git main history, living docs                                                           |
|   2 | Local workflow and dedicated service projects     | Complete                         | Node 22, local stack verified, private GitHub history published, dedicated empty Supabase project provisioned                  |
|   3 | Database, authentication, authorization, and RLS  | Complete                         | 33 typed tables including security counters, migrations/seed, Auth, owner checks, RLS/grants integration tests                 |
|   4 | Candidate profile and deterministic eligibility   | Complete                         | Resume-derived seed; full-time/experience/clearance/Public Trust/sponsorship/location/role tests                               |
|   5 | Connector platform and compliant network layer    | Complete                         | Contract, safe HTTP/SSRF, pagination, conditions, retries/pacing/confidence/unsupported diagnostics                            |
|   6 | Official ATS and employer connectors              | Complete                         | Greenhouse/Lever/Ashby live smokes; JSON-LD contract tests; gated providers documented                                         |
|   7 | Broad discovery and company expansion             | Complete                         | Brave/Adzuna live smokes, sensor-only promotion, quotas/usage, promising-company promotion                                     |
|   8 | Canonicalization, change detection, and lifecycle | Complete                         | Identity/fingerprints, snapshots/material hash, unchanged fast path, closure/reopen/stale DB tests                             |
|   9 | AI extraction, evaluation, and budget controls    | Complete                         | Responses structured output, schema/evidence/prompt-injection defense, changed-only calls, $25 breaker, live smoke             |
|  10 | Explainable ranking, recommendations, and actions | Complete                         | Ten dimensions, bands/urgency/freshness, optimistic queue actions/history/audit, Apply lifecycle guards                        |
|  11 | Durable scheduled workflow                        | Complete                         | Five registered functions, stable identity/retries/concurrency/dead letters; real changed scan recovered after partial failure |
|  12 | Slack alerts and morning digest                   | Complete                         | Block Kit, exact Eastern time, quiet defer, idempotency/retry; labelled real setup check succeeded                             |
|  13 | Responsive portal                                 | Complete                         | All routes/actions/states, four viewport Playwright matrix and Axe checks passed, live console/network inspection clean        |
|  14 | Security, privacy, observability, and recovery    | Complete                         | Rate limits, validation, SSRF, CSP/headers, safe logs/export/delete, operations diagnostics, optional redacted Sentry          |
|  15 | Integrated QA, production deployment, and soak    | QA complete / deployment blocked | Release gate and database bootstrap complete; Vercel deployment and production soak remain                                     |

## Implemented milestones

1. Foundation: Next.js 16, React 19, strict exact-optional TypeScript, Tailwind, ESLint zero warnings,
   Prettier, Vitest, Playwright/Axe, pnpm lockfile/build-script allowlist, CI, Node 22.
2. Persistence/Auth: PostgreSQL schema/migrations, seed, Supabase Auth, single-owner server checks,
   defense-in-depth RLS, user scoping, durable HMAC sign-in/operations throttles.
3. Matching: authoritative normalized descriptions, deterministic hard filtering before AI,
   uncertain Review, compact versioned OpenAI extraction, evidence validation, durable cost budget,
   ten persisted dimensions and deterministic routing.
4. Discovery/lifecycle: compliant connector registry and safe HTTP, official ATS connectors, broad
   sensors, provisional expansion, canonical dedupe, observations/snapshots, change/closure/reopen.
5. Operations: Inngest leases/fan-out/per-changed-listing steps, retries/failure/dead-letter replay,
   exact-time Slack, usage accounting, cleanup, operations health.
6. Product: polished responsive queue/detail/watchlist/referral/operations/settings portal,
   Apply/Save/Dismiss persistence, accessibility, success/error/loading/empty/stale states,
   export/deletion.
7. Release: unit/component/connector/API/domain/worker/database/security/browser suites, real
   provider smokes, production build, browser console/network/server/worker/database inspection,
   architecture/source/matching/operations/test documentation.

## Evidence log

- Initial inspection found no existing FirstSeen repository or source code. A dedicated Git
  repository was initialized on `main`; unrelated configured projects were excluded.
- The attached resume was extracted and visually inspected before implementing the candidate seed.
- Local Supabase Docker services run with all migrations and seed applied. Local owner credentials
  are generated without output and stored in macOS Keychain.
- A separate FirstSeen Supabase Free project was created only after its empty public schema was
  verified. Four migrations produced 33 public tables, all 33 have RLS enabled, and exactly one
  owner, candidate profile, and preference record were created. The unrelated ProofCheck project
  was queried read-only and received no FirstSeen tables, migrations, Auth changes, or data writes.
- The dedicated repository deploy key has repository-only read/write access. All three local
  commits were published to private GitHub `main`, and the remote head was verified byte-for-byte
  against the local commit.
- Auth/RLS tests prove owner access, cross-user denial, and anon denial. Database suites prove
  idempotent ingest/material snapshots, closure/reopening, status history, stale urgency, and closed
  queue behavior.
- Real official connector checks returned 178 Greenhouse, 100 paginated Lever, and 23 Ashby
  listings. Brave and Adzuna credentialed checks completed; OpenAI structured extraction succeeded
  with the configured `gpt-5.6-luna` model.
- A labelled Slack setup check returned HTTP 200. A real local Inngest notification trace completed
  all database/digest/deferred/retry steps.
- Source worker no-change path completed with 304/no analysis. A forced local material change first
  exposed a driver timestamp defect, then the same durable run retried and succeeded: six official
  jobs, exactly one changed/analyzed listing, zero failures. Regression tests cover the root cause.
- Unit/component suites: 113 passing with 6 database-gated cases skipped in the default command.
  Database integration suite: 7 passing across 5 files when explicitly enabled.
- Playwright: 12 passing scenarios across 390×844, 768×1024, 1440×900, and 1920×1080. Core views
  produced no Axe violations. Queue persistence, validation recovery, export, settings, mobile nav,
  browser console, network, server logs, worker traces, and persisted rows were inspected.
- Live authenticated portal inspection found expected heading/cards, no horizontal overflow, and no
  browser console errors/warnings. Responsive screenshots were visually inspected.

## Remaining external production blockers

These are genuine provider/account blockers, not unresolved engineering choices:

1. The prior Vercel token appeared in a CLI response and is considered compromised. Revoke/rotate
   it before any deployment and update the ignored secrets file or authenticate the Vercel CLI.
2. Optional Sentry has an auth token but no DSN/project configuration. Deployment can proceed with
   Vercel/Inngest/database diagnostics; Sentry may be enabled after a project is created.

No production web deployment or production-soak claim is made while these blockers remain. After
Vercel remediation: create/link the Vercel project, configure encrypted environment variables,
sync/register Inngest, verify Slack, run production provider/browser/security smoke tests, inspect
all telemetry/state, soak scheduled scans/digest for 24 hours, and record final rollback/backup
evidence.
