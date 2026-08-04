# FirstSeen implementation plan and evidence

Original system approved 2026-08-03 and deployed. Freshness-first overhaul approved 2026-08-04.
This living record distinguishes verified evidence from pending production work.

## Freshness-first milestones

|   # | Milestone                         | Status   | Objective evidence                                                                                                                     |
| --: | --------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Baseline and policy specification | Complete | Production baseline captured; shared deterministic freshness/company policy and independent rollout flags implemented                  |
|   2 | Backward-compatible persistence   | Complete | Idempotent migration passed empty-local rebuild, production apply/backfill, checks/indexes, Auth/RLS, export and deletion tests        |
|   3 | Company domain/lifecycle          | Complete | Interest/referral/scope independent; Follow preserves origin; dismissal quarantine sticky; cadence combinations tested                 |
|   4 | Freshness policy/server feed      | Complete | Dynamic official/reopen/fallback policy, age sections, server windows/sorts, URL restoration, ancient-date prevention tested           |
|   5 | Matches UX                        | Complete | Explicit three-time provenance, responsive controls/sections/states/actions; four-viewport visual/Axe/browser pass                     |
|   6 | Company UX                        | Complete | My/Discovered/All views, automatic provenance, interest/referral/follow/dismiss controls and persisted cadence exercised               |
|   7 | Discovery/scheduling              | Complete | 15/60/240 tiers, provisional verification, Warm/Cold transitions, current-version replay and missing-board quarantine verified         |
|   8 | Slack overhaul                    | Complete | Fresh Hot/Strong occurrence alerts, grouped since-prior digest, empty skip, safe Block Kit and idempotency; production digest verified |
|   9 | Observability/cost/docs           | Complete | Tier/cadence/date-confidence/detection-latency/capacity diagnostics, cost ledger, test/operations/product/source docs                  |
|  10 | Production rollout and iteration  | Complete | Backup, migration, staged flags, GitHub/Vercel release, source replay, Slack, cloud state, logs and authenticated browser verified     |

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
- Formatting, zero-warning lint, strict types, all 218 tests, coverage gate, low-threshold dependency
  audit, and optimized build pass.
- Coverage: 87.15% statements, 77.45% branches, 88.98% functions, 89.21% lines. The untouched prior
  release failed its configured branch/function gate; layered exclusions now assign outer network/
  worker and declarative schema verification to database/worker/browser suites.
- Playwright: 16/16 in 2.0 minutes with retries disabled at 390×844, 768×1024, 1440×900, and 1920×1080. No page
  console error, page exception, HTTP 5xx, or Axe violation remained; fresh visuals were inspected.
- Real providers: Greenhouse 176/open, Lever 100 paginated/open, Ashby 24/open; Brave 8 candidates
  (7 supported official URLs), Adzuna valid/zero; OpenAI Luna structured evidence valid; labelled
  Slack HTTP 200.
- Real app plus Inngest run finalized 176 official Figma listings successfully. Redelivery of the
  identical occurrence kept exactly one scan row and produced no unresolved dead letter.

## Production release evidence

- A protected logical backup was created outside the repository and its roles, schema, and data
  artifacts were verified non-empty before migration. All five migrations are present on dedicated
  FirstSeen Supabase ref `tlhwxayhjamopnnlroke`; the ProofCheck project was not touched.
- GitHub `main` and the Vercel production deployment contain the freshness, company, Slack, skills
  matching, missing-board quarantine, and foreign-only location fixes. Company scope, feed, and
  Slack rollout flags were enabled and deployed independently.
- A current-policy replay completed 45/45 active official-source runs successfully. The obsolete
  Evenup Ashby board returned an externally confirmed 404, was quarantined, and its two prior dead
  letters were resolved. Production now shows 45 active sources, zero unresolved dead letters, zero
  active source errors, zero failed notifications, and no future official dates.
- The authenticated production feed contains eight current visible jobs; all eight official pages
  and application URLs were fetched directly and their posted instants matched persisted data. An
  explicit Sweden-only remote listing found during rollout is now deterministically excluded.
- Authenticated browser validation confirmed a seven-day/newest-official default, age sections,
  URL-restored filters/sorts, separate My/Discovered company scopes, explicit date provenance, and
  explainable dimensions. No production browser warning or error remained.
- The 2026-08-04 morning Slack digest delivered once at 8:00:04 AM Eastern with eight jobs. There
  were no duplicate idempotency groups and no qualifying under-24-hour Hot/Strong job requiring an
  immediate production alert.
- Vercel's only two errors in the inspected timeline were the pre-fix Evenup 404 at 10:17 AM. No
  post-fix runtime error, HTTP 5xx, unresolved worker failure, or active-source error remained.

## Release constraints and follow-up

- Only dedicated Supabase ref `tlhwxayhjamopnnlroke` may receive FirstSeen schema/data changes.
  ProofCheck ref `cuwfwassuxozafpbvjao` must never be mutated.
- The verified pre-migration backup remains mode `600` outside the repository as a short-term
  rollback artifact. Never copy or commit it; remove it after the desired rollback-retention window.
- Preserve stale jobs and all user history. Operational monitoring must continue to warn rather than
  silently weakening priority cadence when capacity approaches provider quotas.
- A previously exposed Vercel token was already considered compromised in the original release and
  must remain revoked/replaced provider-side; do not use it if still present in an ignored file.
- Optional Sentry remains unnecessary without a DSN/project; Vercel, Inngest, operations data, and
  provider dashboards are the production diagnostics.
