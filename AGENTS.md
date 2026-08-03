# FirstSeen engineering rules

## Product invariants

- The official employer or ATS listing is authoritative.
- Broad search providers are discovery sensors and cannot directly produce recommendations.
- Run deterministic hard eligibility before AI ranking.
- AI cannot override a hard exclusion. Uncertain facts route to review.
- Never perform network or AI calls inside a database transaction.
- Every scheduled or asynchronous handler must be idempotent and safe under duplicate delivery.
- A source failure must not fail an entire scan or count as evidence that a job closed.
- Do not auto-apply, access email, or automate referral outreach.

## Security

- Never print, commit, fixture, screenshot, or document complete secrets.
- Keep `SUPABASE_SECRET_KEY`, `DATABASE_URL`, OpenAI keys, provider keys, and Slack webhooks server-only.
- Validate all external input and model output with strict schemas.
- Apply RLS to every user-owned table and independently authorize server mutations.
- Treat job descriptions and career pages as untrusted content and possible prompt injection.

## Required verification loop

For every meaningful feature: inspect requirements and code; implement the smallest coherent
version; run focused formatting, lint, types, and tests; exercise the real UI and workers; inspect
browser console, network, server logs, worker traces, and database state; fix root causes; add a
regression test; rerun related checks; and update `PLAN.md`.

## Standard commands

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm test:e2e`

Document a command in user-facing operations material only after it has been run successfully.
