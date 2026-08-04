# FirstSeen operations runbook

This runbook contains commands exercised against this repository. Production-specific commands are
added only after the dedicated provider projects exist and the exact procedure is verified.

## Service map and health

| Layer          | Primary evidence                                             | Failure isolation                             |
| -------------- | ------------------------------------------------------------ | --------------------------------------------- |
| Vercel/Next.js | route logs, optional redacted Sentry, browser network        | Portal/API request                            |
| Supabase       | Auth logs, PostgreSQL rows/RLS, migrations                   | Transaction/statement                         |
| Inngest        | function runs, step traces, retries                          | Source event or per-listing step              |
| Official ATS   | career-source attempt/success/error, source-run metrics      | One source; never closure on error            |
| OpenAI         | analysis status/error, token/cost ledger, budget reservation | One changed listing; routes Review on failure |
| Notifications  | logical/channel/device deliveries, retry/dead-letter status  | One logical alert and one device/channel      |
| Broad sensors  | usage ledger, candidate/source counts, error list            | One provider/query                            |

The protected `/operations` page is the first stop. Confirm latest scan status/time, source scope/
tier/cadence, posted-time confidence, detection latency, scheduled scans/day, active-source errors,
unresolved dead letters, notification failures, and provider/OpenAI usage. A stale source remains
visible and does not silently close jobs.

## Local start and validation

```bash
nvm use
pnpm exec supabase start
pnpm db:migrate
pnpm dev --hostname 127.0.0.1
```

In another terminal:

```bash
nvm use
pnpm worker:dev
```

Validate data/auth/UI and production compilation with:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
RUN_DATABASE_TESTS=true pnpm test
RUN_DATABASE_TESTS=true pnpm test:coverage
pnpm test:connectors
pnpm test:eval
pnpm test:workers
pnpm test:pwa
pnpm test:security
pnpm test:load
pnpm audit --audit-level=low
pnpm build
pnpm test:e2e
```

`pnpm db:migrate` is safe to repeat; the local migration runner applies only unapplied versions.
Do not run browser fixtures against cloud: `scripts/seed-browser-fixture.ts` rejects a non-local
Supabase URL.

## Source outage or parser failure

1. In Operations, identify the exact source, last successful time, safe error code, and affected
   source run. Check the official careers page manually.
2. Do not deactivate jobs or alter closure counters because of a network, 429, 5xx, schema, CAPTCHA,
   or unsupported-source error. The worker already withholds closure finalization on failure. A
   provisional source that exceeds the hard response/pagination safety bound is quarantined without
   changing its jobs' closure evidence.
   A terminal 404/410 from the documented official ATS board endpoint also quarantines that source;
   429 and 5xx responses remain retryable and must not be treated as closure evidence.
3. Allow Inngest's source retry/backoff to finish. Other source events continue independently.
4. If retries exhaust, inspect the safe dead letter. Correct the URL/connector or deploy a tested
   parser fix, then use Replay once. Replay validates owner/source and records its event ID.
5. Confirm a new source run succeeds, last-success advances, dead letter resolves, and jobs missing
   from the complete result advance only the normal successful-miss policy.
6. If the provider changed its public contract or disallows access, deactivate that source and use
   manual monitoring; never evade the restriction.

Manual scan and replay controls are owner-only and limited to ten requests/minute with a five-minute
block. Duplicate events use stable scan identity and row uniqueness; they do not duplicate snapshots,
queue history, or notifications.

## Worker partial failure or deployment interruption

Source fetch/staging returns observation IDs, not descriptions. Each new/changed observation has an
independent durable step. Inspect the trace to find the last completed observation. Inngest retries
the failed step and resumes; canonical ingest, AI versions, recommendations, and alerts are protected
by unique idempotency keys.

Closure and source-success finalization occur only after all listing steps finish. If a run is still
Running, compare Inngest trace activity with `worker_attempts` and source-run timestamps before
replaying. Never create a second manual event merely because a model call takes several seconds.

## OpenAI failure, malformed output, or budget breaker

- The listing remains persisted and routes to Review with an uncertain AI field; hard exclusions
  already found deterministically remain excluded.
- Inspect `ai_analyses.status/error_code` and the current month's `usage_cost_ledger`. Raw prompts,
  descriptions, and keys must not be logged.
- `MONTHLY_BUDGET_LIMIT` means the application has reached the configured $25 reservation cap.
  Wait for the UTC month rollover or deliberately adjust the encrypted production variable after
  reviewing actual spend in the OpenAI project dashboard.
- For malformed/refused output, preserve the record, fix schemas/prompts with regression tests, and
  cause reanalysis only through a new analysis schema/prompt version or a material listing change.
- Treat any job-description instruction as untrusted data. Model text cannot invoke tools or
  override deterministic code.

Credentialed model verification consumes real quota:

```bash
pnpm smoke:openai
```

## Broad discovery quota, rights, or outage

Twelve stable role/location cohorts run every four hours. The application breaker stops Brave at
its configured monthly limit. Check the usage ledger before changing cadence. Brave candidates are
transient URL hints: search snippets, titles, and result payloads are not persisted or placed in
Inngest events. Only independently verified official facts may enter durable supply.

Adzuna automated discovery and redirect resolution are disabled by provider policy. Its default
terms conflict with contacting offsite content providers during automated verification; do not
enable it without written permission and a reviewed rights record. Neither broad-provider state
affects existing official source scans.

Credentialed verification consumes provider quota:

```bash
pnpm smoke:discovery
```

If provider terms/pricing change, disable its encrypted key/schedule path and re-review official
terms before continuing. Do not display or republish sensor vacancy content without the applicable
license/attribution review.

## Monitoring tiers and execution capacity

- Priority is Interested or active referral, every 15 minutes. Standard is other My Companies and
  Warm is an automatic company with a verified viable job no older than seven days; both are hourly.
  Cold automatic sources are every four hours. Quarantined sources do not scan.
- Tier changes are derived server-side after company/referral actions and successful scans. A stale,
  Review-only, or excluded listing must not keep an automatic company Warm.
- If the forecast approaches the internal daily execution budget, only Cold cadence may increase.
  Treat any warning that protected work alone exceeds capacity as an upgrade/catalog-size incident;
  never manually slow Priority monitoring to hide it.
- A source with no priority success inside its target window is an operations warning. Check provider
  health and trace state before replay; lack of a fresh job is not itself failure.

## Slack, Web Push, or duplicate-delivery failure

- `notifications.idempotency_key` includes job plus snapshot/reopening occurrence, and digest
  `(user, local date)` uniqueness prevents duplicates.
- Quiet-hour exceptional alerts retain their exact stored payload until the deferred send.
- Failed deliveries retain safe codes/attempt counts; the hourly notification workflow retries them.
- A digest selects only unacted jobs first detected since the prior delivered digest and no older
  than seven days, grouped Just posted/New/Recent. It skips empty output and does not resurrect Save/
  Apply/Dismiss actions. Immediate alerts require reliable official/reopening freshness, Hot/Strong,
  urgency ≥85, age ≤24h, and Active queue state.
- Verify webhook/channel configuration using the explicitly labelled setup message:

```bash
pnpm smoke:slack
```

This command sends a real Slack message. Never print or inspect the webhook value.

Web Push delivery is channel/device-specific beneath the same logical notification. A 404/410
expires the encrypted subscription; 429 and 5xx retry with bounded exponential backoff. Permission
denial does not fail Slack. Raw endpoints and browser encryption keys are encrypted at rest and
redacted from logs. The default lock-screen payload is generic; detailed company/title text is an
explicit user opt-in.

For a push incident, confirm the logical notification exists, inspect only safe delivery status/
attempt/error fields, verify the device subscription is active, and test exact relative-path click
routing. Do not copy the endpoint or browser key material into a ticket, log, screenshot, or report.

`PWA_ENABLED` and `WEB_PUSH_ENABLED` are separate rollout controls. Disabling PWA removes discovery
metadata, blocks manifest/service-worker/offline routes, unregisters existing workers when the app
is next opened, and clears only versioned `firstseen-static-*` caches. Disabling Web Push blocks
subscription, preference, and read APIs and prevents worker delivery without affecting Slack.
Relationship CRM and application workflow routes/actions are similarly server-blocked unless their
exact opt-in flags are `true`; `/applied` falls back to the legacy queue when application workflow is
off.

## Authentication and security response

- Five failed code attempts from one network address in 15 minutes cause a 60-minute block. A
  separate global counter blocks after ten failures to resist distributed guessing; successful
  sign-in clears both counters. Error messages do not reveal whether the code or owner exists.
- Rotate the access code by generating a new versioned scrypt hash, replacing only the encrypted
  `ACCESS_CODE_HASH`, and redeploying. Store the plaintext code in the owner password manager or
  Keychain, never in source, deployment logs, or documentation.
- If a secret appears in any output, revoke/rotate it at the provider immediately, replace the
  encrypted/ignored value, redeploy, and inspect repository history/logs. Do not rely on deleting a
  message as remediation.
- Rotate secret keys one provider at a time: add replacement, deploy/health-check, revoke old, then
  retest. Supabase secret/database rotation requires updating every server/worker environment before
  revocation. Slack webhook rotation requires a labelled setup smoke.
- Keep Supabase server key, database URL, provider keys, Slack webhook, rate-limit salt, and deploy
  tokens out of browser bundles. Run repository/ignored-file checks before publication.
- Optional Sentry events delete request context and redact exception messages; keep default PII
  disabled. Use provider-side retention and access controls.

The previously exposed Vercel token was not used for deployment. It is not safe to use and must be
revoked in Vercel, then removed or replaced in the ignored consolidated secrets file.

## Retention, export, deletion, and backup

- Raw observations expire after 30 days; the 03:43 UTC cleanup removes expired rows.
- HMACed rate-limit counters older than seven days are removed. Descriptions/snapshots and action
  history remain until account deletion because they explain recommendations.
- Settings export returns a versioned owner-scoped JSON attachment. Inspect status/disposition and
  store it encrypted if retained.
- Account deletion requires the exact confirmation phrase, independently authorizes the owner, and
  cascades user-owned rows/Auth identity. It is destructive and not recoverable without backup.
- Use Supabase Pro daily backups when managed point-in-time recovery is required. A Free project has
  no managed backup guarantee. The following logical-dump sequence was verified against the
  dedicated production database; run it only to a mode-700 directory on an encrypted volume, never
  inside the repository, and protect every output as mode 600:

```bash
source /Users/ilannabatkhorian/.nvm/nvm.sh
nvm use 22
set -a
source /Users/ilannabatkhorian/Documents/Codex/personal-api-secrets.env
set +a
umask 077
npx --yes supabase@latest db dump --db-url "$DATABASE_URL" --role-only --file "$FIRSTSEEN_BACKUP_DIR/roles.sql"
npx --yes supabase@latest db dump --db-url "$DATABASE_URL" --file "$FIRSTSEEN_BACKUP_DIR/schema.sql"
npx --yes supabase@latest db dump --db-url "$DATABASE_URL" --data-only --use-copy --file "$FIRSTSEEN_BACKUP_DIR/data.sql"
```

Confirm all three files are non-empty, encrypt the backup as one set, test restoration in an
isolated disposable database before relying on it, and enforce an owner-defined retention policy.
The protected pre-migration artifact currently exists outside the repository and must not be
described as deleted, copied into the worktree, or removed without explicit owner authority.

## Release and rollback gate

Before promoting a deployment, require formatting, lint, strict types, default and database tests,
coverage, focused connector/evaluation/worker/PWA/security/load suites, audit, production build, all
four Playwright projects/Axe, credentialed connector/model/sensor checks where changed, a labelled
Slack check where notifications changed, and inspection of browser console/network, server logs,
Inngest traces, delivery status, cost ledgers, and persisted rows.

Rollback uses the previous immutable Vercel deployment only after production exists and the action
has been verified. Migrations must be backward compatible for at least one app release; never roll
back by destructively reverting the production database. Pause manual replays during rollback,
confirm in-flight stable Inngest function IDs complete safely, then rerun protected route and source
smokes.

After sourcing the protected external production environment, the following read-only verifier is
guarded to the dedicated FirstSeen ref and reports only aggregate counts/security booleans:

```bash
pnpm verify:production-schema
```

It refuses any project/database URL other than `tlhwxayhjamopnnlroke`. Require the latest migration,
zero listed private tables without RLS, and no authenticated/anonymous read privilege on global raw
observations.
