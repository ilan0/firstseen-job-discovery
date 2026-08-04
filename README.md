# FirstSeen

FirstSeen is a private freshness-first job-search portal. It finds software-engineering roles at
official employer sites, verifies every recommendation at the employer or ATS, applies the
candidate's deterministic eligibility rules, and presents a mobile-friendly queue with referral,
application, Slack, and Web Push workflows.

FirstSeen never auto-applies, reads email, contacts referrals, scrapes LinkedIn/Indeed, bypasses a
CAPTCHA, or turns an aggregator result directly into a recommendation.

## What is implemented

- Private four-digit owner access backed by a normal Supabase session, server authorization,
  PostgreSQL RLS, durable throttling, account export, and deletion. Invite-only individual email
  authentication is implemented behind a disabled rollout flag for a future external beta.
- Responsive freshness-first Matches, Saved, Applied, Dismissed, My/Discovered Companies,
  Operations, Settings, and explainable job-detail views.
- Greenhouse, Lever, Ashby, Recruitee, Pinpoint, and reviewed structured-source connectors with
  pagination, conditional requests, bounded outbound HTTP, retries, confidence, change detection,
  closure, and reopening.
- Twelve stable role/location discovery cohorts every four hours. Brave is handled transiently as
  a URL sensor. Adzuna automated promotion is quarantined because its default terms conflict with
  offsite employer verification.
- Canonical identity, cross-source fingerprints, snapshots, first/last-seen times, material hashes,
  no unchanged reanalysis, aging, and duplicate-safe queue transitions.
- Default seven-day feed grouped into Just posted, New, and Recent, with official-posted,
  FirstSeen-detected, and last-verified times kept distinct. Posted windows and official/detection/
  urgency sorts are server-backed and URL-restorable.
- Independent company interest and referrals with 15-minute Priority, hourly Standard/Warm, and
  four-hour Cold monitoring. Automatic provenance survives Follow; Not relevant is sticky.
- Database-driven candidate preferences and deterministic full-time, experience,
  clearance/Public Trust, sponsorship, role, and location rules before schema-constrained OpenAI
  analysis.
- Ten visible ranking dimensions rather than an opaque match score.
- Additive shared canonical-supply tables and a fair oldest-due global source scheduler, with
  private per-user overlays and legacy dual-write/read comparison during rollout.
- Relationship CRM with contacts, company links, interactions, referral requests, reminders, and
  deterministic best-contact recommendations.
- Application sessions, a private resume/application packet, explicit application records and
  stage history. Opening Apply never marks a job Applied.
- Installable PWA metadata, a narrowly scoped service worker, offline recovery, and standards-based
  Web Push with encrypted subscriptions and channel-independent idempotent delivery.
- Explicit `gpt-5.6-luna` candidate-neutral extraction with evidence validation and capped,
  selective `gpt-5.6-terra` escalation.
- Inngest schedules for priority scanning, broad discovery, per-listing durable processing,
  notifications, retries/dead letters, and retention. Slack alerts and the morning digest remain
  enabled for the owner.
- Database-backed scan diagnostics, worker attempts, provider usage/cost ledger, and optional
  privacy-redacted Sentry reporting.

## Local development

Prerequisites are Node 24, pnpm 11, Docker Desktop, and the repository-pinned Supabase CLI package.
Secrets belong only in ignored `.env.local` or encrypted provider deployment settings.
Never copy them into source, fixtures, screenshots, logs, or documentation.

The verified local workflow is:

```bash
nvm use
pnpm install --frozen-lockfile
pnpm exec supabase start
pnpm env:local
pnpm db:bootstrap
pnpm dev --hostname 127.0.0.1
```

In a second terminal, start the durable worker UI:

```bash
nvm use
pnpm worker:dev
```

The portal is at `http://127.0.0.1:3000`; local Inngest diagnostics are at
`http://127.0.0.1:8288`. The private four-digit access code and the generated internal Supabase
owner credential are stored in macOS Keychain; neither is printed or written to the repository.

`pnpm env:local` reads the approved consolidated secrets file outside this repository, writes an
ignored mode-600 `.env.local`, and replaces cloud Supabase values with local development values.
It does not print secrets.

## Verified quality commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
RUN_DATABASE_TESTS=true pnpm test
RUN_DATABASE_TESTS=true pnpm test:coverage
pnpm audit --audit-level=low
pnpm build
pnpm test:e2e
```

Focused release suites are also available:

```bash
pnpm test:connectors
pnpm test:eval
pnpm test:workers
pnpm test:pwa
pnpm test:security
pnpm test:load
```

Provider checks are explicit because they consume real quotas or send a labelled Slack message:

```bash
pnpm smoke:connectors
pnpm smoke:discovery
pnpm smoke:openai
pnpm smoke:slack
```

See [TEST_REPORT.md](./TEST_REPORT.md) for recorded results and [OPERATIONS.md](./OPERATIONS.md) for
failure recovery.

## Production shape

- Vercel serves Next.js and the authenticated application APIs.
- Supabase provides Auth and the authoritative PostgreSQL database.
- Inngest invokes the `/api/inngest` endpoint and owns schedules, retries, fan-out, and independently
  resumable listing work.
- OpenAI runs only for new/materially changed plausible software roles after deterministic hard
  filtering and a durable monthly budget reservation. Candidate-neutral extraction can be shared
  by all private user overlays.
- Slack receives exceptional alerts and the digest. Web Push is independently deliverable when its
  rollout flag is enabled. Brave supplies transient official-URL candidates only. Sentry is
  optional; Vercel, Inngest, and database diagnostics remain available if it is disabled.

The private production portal is live at
[firstseen-job-discovery.vercel.app](https://firstseen-job-discovery.vercel.app). It uses the
dedicated FirstSeen Supabase project, a unique Inngest app, and the private GitHub repository;
unrelated existing projects are deliberately not reused. The Daily-Driver expansion is locally
certified but not represented as production-complete: physical iPhone acceptance and seven
consecutive scheduled production days remain explicit final gates in `PLAN.md`.

## Configuration

`.env.example` is the authoritative name-only template. Browser-exposed variables are limited to
the app URL, Supabase publishable values, and optional public Sentry DSN. Database credentials,
Supabase secret key, OpenAI/search keys, Inngest signing material, Slack webhook, salts, and
deployment tokens are server-only.

Runtime credentials:

| Service           | Required production values                                  | Purpose                                       |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------- |
| Supabase          | URL, publishable key, secret key, database URL, project ref | Auth sessions, RLS, server writes, migrations |
| Owner access      | scrypt access-code hash, owner email, rate-limit salt       | Private code gate and abuse protection        |
| Inngest           | event key, signing key                                      | Durable events and authenticated callbacks    |
| OpenAI            | project key, Luna/Terra models, $25 app budget              | Shared extraction of changed roles            |
| Brave             | Search API key                                              | Transient broad discovery sensor              |
| Slack             | incoming webhook URL                                        | Alerts and morning digest                     |
| Web Push          | VAPID keys, subject, subscription encryption key            | Device alerts without a managed push vendor   |
| Sentry (optional) | DSN; auth token/org/project only at build                   | Redacted errors and source maps               |
| Vercel/GitHub     | deployment token or authenticated CLI                       | Bootstrap/deployment, never app runtime       |

All provider secrets must be stored in Vercel encrypted environment variables and the applicable
Inngest/Supabase secret store, not in the browser or repository.

## Documentation

- [Product requirements](./docs/product-requirements.md)
- [Architecture and data flow](./docs/architecture.md)
- [Matching rules](./docs/matching-rules.md)
- [Discovery sources](./docs/discovery-sources.md)
- [Services and credentials](./docs/credentials.md)
- [Operations](./OPERATIONS.md)
- [Implementation evidence](./PLAN.md)
