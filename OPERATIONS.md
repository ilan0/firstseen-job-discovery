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
| Slack          | notification/digest status, attempt/error, retry             | One idempotency key                           |
| Broad sensors  | usage ledger, candidate/source counts, error list            | One provider/query                            |

The protected `/operations` page is the first stop. Confirm latest scan status/time, active source
success/error, unresolved dead letters, notification failures, and provider/OpenAI usage. A stale
source remains visible and does not silently close jobs.

## Local start and validation

```bash
nvm use
npx --yes supabase@latest start
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
RUN_DATABASE_TESTS=true pnpm vitest run src/db/*.integration.test.ts
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
   or unsupported-source error. The worker already withholds closure finalization on failure.
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

## Broad discovery quota or outage

Initial cadence produces approximately 720 requests/provider/month. The application breaker stops
each provider at 900 requests/month. Check usage ledger before changing cadence. A Brave or Adzuna
error is retained in run diagnostics while the other provider continues; neither affects existing
official watchlists.

Credentialed verification consumes provider quota:

```bash
pnpm smoke:discovery
```

If provider terms/pricing change, disable its encrypted key/schedule path and re-review official
terms before continuing. Do not display or republish sensor vacancy content without the applicable
license/attribution review.

## Slack failure or duplicate prevention

- `notifications.idempotency_key` and digest `(user, local date)` uniqueness prevent duplicates.
- Quiet-hour exceptional alerts retain their exact stored payload until the deferred send.
- Failed deliveries retain safe codes/attempt counts; the hourly notification workflow retries them.
- A digest selects only open/reopened active recommendations and does not resurrect Save/Apply/
  Dismiss actions.
- Verify webhook/channel configuration using the explicitly labelled setup message:

```bash
pnpm smoke:slack
```

This command sends a real Slack message. Never print or inspect the webhook value.

## Authentication and security response

- Five failed attempts for one IP/email pair in 15 minutes cause a 15-minute block; a successful
  sign-in clears its counter. Error messages do not reveal whether credentials exist.
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
isolated project before relying on it, and enforce an owner-defined retention policy. The initial
verification artifacts were permanently deleted rather than retained as plaintext.

## Release and rollback gate

Before promoting a deployment, require formatting, lint, strict types, default tests, database
integration tests, production build, all four Playwright projects/Axe, credentialed connector/model/
sensor checks where changed, a labelled Slack check where notifications changed, and inspection of
browser console/network, server logs, Inngest traces, and persisted rows.

Rollback uses the previous immutable Vercel deployment only after production exists and the action
has been verified. Migrations must be backward compatible for at least one app release; never roll
back by destructively reverting the production database. Pause manual replays during rollback,
confirm in-flight stable Inngest function IDs complete safely, then rerun protected route and source
smokes.
