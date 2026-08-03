# FirstSeen

FirstSeen is a private, single-user job-discovery portal that finds fresh software-engineering
roles at official employer sites before the candidate has to hunt through general job boards. It
monitors referral and priority companies, uses broad providers only as discovery sensors, verifies
every vacancy at the employer or ATS, enforces hard eligibility rules, ranks viable roles with
separate explainable dimensions, and sends Slack alerts and a morning digest.

FirstSeen never auto-applies, reads email, contacts referrals, scrapes LinkedIn/Indeed, bypasses a
CAPTCHA, or turns an aggregator result directly into a recommendation.

## What is implemented

- Secure Supabase sign-in for one configured owner, server authorization, PostgreSQL RLS, durable
  sign-in throttling, account export, and deletion.
- Responsive Active, Saved, Applied, Dismissed, Watchlist, Operations, Settings, and explainable
  job-detail views.
- Greenhouse, Lever, Ashby, and reviewed JSON-LD connectors with pagination, conditional requests,
  safe outbound HTTP, retries, confidence, change detection, closure, and reopening.
- Brave Search and Adzuna discovery sensors. A result advances only when it resolves to a supported
  official ATS URL.
- Canonical identity, cross-source fingerprints, snapshots, first/last-seen times, material hashes,
  no unchanged reanalysis, aging, and duplicate-safe queue transitions.
- Deterministic full-time, experience, clearance/Public Trust, sponsorship, role, and location
  rules before schema-constrained OpenAI analysis.
- Ten visible ranking dimensions rather than an opaque match score.
- Inngest schedules for priority scanning, broad discovery, per-listing durable processing,
  notifications, retries/dead letters, and retention.
- Idempotent Slack exceptional alerts and an exact-time-zone morning digest.
- Database-backed scan diagnostics, worker attempts, provider usage/cost ledger, and optional
  privacy-redacted Sentry reporting.

## Local development

Prerequisites are Node 22, pnpm 11, Docker Desktop, and the Supabase CLI runtime used by the npm
package. Secrets belong only in ignored `.env.local` or encrypted provider deployment settings.
Never copy them into source, fixtures, screenshots, logs, or documentation.

The verified local workflow is:

```bash
nvm use
pnpm install --frozen-lockfile
npx --yes supabase@latest start
pnpm env:local
pnpm db:migrate
pnpm db:seed
pnpm db:owner
pnpm db:fixture
pnpm dev --hostname 127.0.0.1
```

In a second terminal, start the durable worker UI:

```bash
nvm use
pnpm worker:dev
```

The portal is at `http://127.0.0.1:3000`; local Inngest diagnostics are at
`http://127.0.0.1:8288`. The local owner password is stored in macOS Keychain by `pnpm db:owner`.

`pnpm env:local` reads the approved consolidated secrets file outside this repository, writes an
ignored mode-600 `.env.local`, and replaces cloud Supabase values with local development values.
It does not print secrets.

## Verified quality commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
RUN_DATABASE_TESTS=true pnpm vitest run src/db/*.integration.test.ts
pnpm build
pnpm test:e2e
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
- Inngest invokes the `/api/inngest` endpoint, owns schedules/retries, and persists each listing as
  an independently resumable step.
- OpenAI runs only for new/materially changed plausible software roles after deterministic hard
  filtering and a durable monthly budget reservation.
- Slack receives exceptional alerts and the digest. Brave/Adzuna feed only official-source
  candidates. Sentry is optional; Vercel, Inngest, and database diagnostics remain available if it
  is disabled.

The dedicated production Supabase project and private GitHub history are provisioned. Web
deployment is gated only by the external Vercel credential item recorded in `PLAN.md`; unrelated
existing projects are deliberately not reused.

## Configuration

`.env.example` is the authoritative name-only template. Browser-exposed variables are limited to
the app URL, Supabase publishable values, and optional public Sentry DSN. Database credentials,
Supabase secret key, OpenAI/search keys, Inngest signing material, Slack webhook, salts, and
deployment tokens are server-only.

Runtime credentials:

| Service           | Required production values                                  | Purpose                                    |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------ |
| Supabase          | URL, publishable key, secret key, database URL, project ref | Auth, RLS, server writes, migrations       |
| Inngest           | event key, signing key                                      | Durable events and authenticated callbacks |
| OpenAI            | project API key, model, $25 app budget                      | Structured analysis of changed roles       |
| Brave             | Search API key                                              | Broad discovery sensor                     |
| Adzuna            | app ID and app key                                          | Secondary broad sensor                     |
| Slack             | incoming webhook URL                                        | Alerts and morning digest                  |
| Sentry (optional) | DSN; auth token/org/project only at build                   | Redacted errors and source maps            |
| Vercel/GitHub     | deployment token or authenticated CLI                       | Bootstrap/deployment, never app runtime    |

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
