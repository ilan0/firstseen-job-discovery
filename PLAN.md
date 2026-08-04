# FirstSeen implementation plan and evidence

Original system approved 2026-08-03 and deployed. Freshness-first overhaul approved 2026-08-04.
This living record distinguishes verified evidence from pending production work.

## Freshness-first milestones

|   # | Milestone                         | Status         | Objective evidence                                                                                                                        |
| --: | --------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Baseline and policy specification | Complete       | Production baseline captured; shared deterministic freshness/company policy and independent rollout flags implemented                     |
|   2 | Backward-compatible persistence   | Local complete | Idempotent migration rebuilds from empty local database; checks/indexes/backfill and all Auth/RLS tests pass                              |
|   3 | Company domain/lifecycle          | Local complete | Interest/referral/scope independent; Follow preserves origin; dismissal quarantine sticky; cadence combinations tested                    |
|   4 | Freshness policy/server feed      | Local complete | Dynamic official/reopen/fallback policy, age sections, server windows/sorts, URL restoration, ancient-date prevention tested              |
|   5 | Matches UX                        | Local complete | Explicit three-time provenance, responsive controls/sections/states/actions; four-viewport visual/Axe/browser pass                        |
|   6 | Company UX                        | Local complete | My/Discovered/All views, automatic provenance, interest/referral/follow/dismiss controls and persisted cadence exercised                  |
|   7 | Discovery/scheduling              | Local complete | 15/60/240 tiers, immediate provisional verification, valid Warm transition, Cold-only adaptive cadence, real durable source run           |
|   8 | Slack overhaul                    | Local complete | Fresh Hot/Strong occurrence alerts, grouped since-prior digest, empty skip, safe Block Kit and idempotency; labelled webhook smoke passed |
|   9 | Observability/cost/docs           | Local complete | Tier/cadence/date-confidence/detection-latency/capacity diagnostics, current model prices, test/operations/product/source docs            |
|  10 | Production rollout and iteration  | In progress    | Local release gate complete; backup, cloud migration, staged flags, deployment, production rows/logs/traces/browser remain                |

## Captured baseline

- Production initially had 37 active matches: zero under 24 hours, one at 1–3 days, eight at 3–7
  days, five at 7–30 days, and 23 older than 30 days. There were 17 Possible and 20 Review jobs.
- All 34 active company watches originated from broad discovery, with no referrals, but the prior UI
  presented them as a personal watchlist.
- Scheduler ran every 15 minutes, broad discovery every four hours, and notifications hourly. Prior
  immediate alerts were Hot-only; digest could include up to 36-hour recommendation age and send an
  empty message.
- Proposed shadow membership is queryable behind `FRESHNESS_FIRST_FEED_ENABLED`,
  `COMPANY_SCOPE_UI_ENABLED`, and `FRESHNESS_FIRST_SLACK_ENABLED`. Flags default enabled but may be
  disabled independently during rollout.

## Implemented design evidence

1. `src/domain/jobs/freshness.ts` is authoritative for normalized timestamps, dynamic age, feed
   section, posted window, and sorting inputs. Official date never derives from sensor text.
2. The feed defaults to seven days/newest official occurrence and exposes 6h/24h/3d/7d/30d/All,
   detection-newest, and urgency parameters. Saved/Applied/Dismissed history bypasses freshness
   deletion.
3. Initial snapshots have no material-change reasons. Actual edits show Updated but retain posting
   age. A closed unchanged listing is first-class reopening: it reranks cached extraction without a
   new AI call and uses reopening occurrence idempotency.
4. `src/domain/companies/monitoring.ts` derives Priority/Standard/Warm/Cold/Quarantined. Only a
   verified eligible Hot/Strong/Possible job no older than seven days can make discovery Warm.
5. Broad providers remain sensor-only. Greenhouse, Lever, Ashby, and reviewed JSON-LD remain the
   only implemented official paths. LinkedIn/Indeed/Glassdoor scraping is absent.
6. Slack uses the shared freshness policy. Immediate alerts require reliable official/reopening age
   ≤24h, Hot/Strong, urgency ≥85, and Active action. Digest is since the previous delivery, ≤7d,
   grouped Just posted/New/Recent, and skips empty.
7. The active queue requires current deterministic eligibility and ranking versions. This hides
   stale-policy recommendations during rollout instead of exposing them before source refresh.
   Explicit unsupported-country remote restrictions are hard exclusions; ambiguous US restrictions
   still route Review.

## Local release evidence

- Exact local database reset applied all five migrations including
  `20260804090000_freshness_first.sql` from scratch.
- Formatting, zero-warning lint, strict types, all 209 tests, coverage gate, low-threshold dependency
  audit, and optimized build pass.
- Coverage: 86.80% statements, 76.51% branches, 88.31% functions, 88.91% lines. The untouched prior
  release failed its configured branch/function gate; layered exclusions now assign outer network/
  worker and declarative schema verification to database/worker/browser suites.
- Playwright: 16/16 with retries disabled at 390×844, 768×1024, 1440×900, and 1920×1080. No page
  console error, page exception, HTTP 5xx, or Axe violation remained; fresh visuals were inspected.
- Real providers: Greenhouse 176/open, Lever 100 paginated/open, Ashby 24/open; Brave 8 candidates
  (7 supported official URLs), Adzuna valid/zero; OpenAI Luna structured evidence valid; labelled
  Slack HTTP 200.
- Real app plus Inngest run finalized 176 official Figma listings successfully. Redelivery of the
  identical occurrence kept exactly one scan row and produced no unresolved dead letter.

## Release constraints and follow-up

- Only dedicated Supabase ref `tlhwxayhjamopnnlroke` may receive FirstSeen schema/data changes.
  ProofCheck ref `cuwfwassuxozafpbvjao` must never be mutated.
- Create and validate non-empty logical backup artifacts immediately before the production
  migration. Do not retain plaintext backup in the repository.
- Apply backward-compatible schema before app behavior. Inspect old versus new membership, then
  enable company scope, freshness feed, and Slack independently. Preserve stale jobs and all user
  history.
- Verify GitHub remote head, Vercel immutable deployment, Inngest registration/signed callbacks,
  browser console/network, server logs, worker traces, Supabase rows, date/source of every visible
  production match, notification/dead-letter state, and immediate post-rollout health.
- A previously exposed Vercel token was already considered compromised in the original release and
  must remain revoked/replaced provider-side; do not use it if still present in an ignored file.
- Optional Sentry remains unnecessary without a DSN/project; Vercel, Inngest, operations data, and
  provider dashboards are the production diagnostics.
