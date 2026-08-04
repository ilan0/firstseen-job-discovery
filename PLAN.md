# FirstSeen implementation plan and evidence

Original system approved 2026-08-03 and deployed. Freshness-first overhaul approved 2026-08-04.
Daily-Driver expansion approved and implemented locally 2026-08-04. This living record
distinguishes verified evidence from pending production, temporal, licensed-provider, and
physical-device work.

## Daily-Driver master-plan milestones

|   # | Milestone                                       | Status           | Objective evidence or remaining gate                                                                                                                                       |
| --: | ----------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   0 | Baseline/compliance containment                 | Complete locally | Brave result fields removed from persistence; Adzuna promotion disabled by provider policy; backup/token discrepancies documented                                          |
|   1 | Policy, contracts, and benchmark foundation     | Complete locally | Versioned provider capabilities/licenses and minimized URL-hash coverage benchmarks implemented; no fabricated independent recall claim                                    |
|   2 | Detection, redirects, authority, query overhaul | Complete locally | Twelve stable role/location cohorts; SSRF-safe redirect and organization-authority contracts; custom JSON-LD independently verified                                        |
|   3 | Public ATS connectors                           | Complete locally | Greenhouse, Lever, Ashby, Recruitee, and Pinpoint contract and live bounded smoke checks pass                                                                              |
|   4 | Reviewed structured/licensed sensor foundation  | Partial          | Reviewed JSON-LD/RSS/Atom/sitemap contracts implemented; licensed-vendor bakeoff awaits a user-authorized account/contract                                                 |
|   5 | Shared supply and private overlays              | Complete locally | Additive global schema, conservative backfill, dual write, global scheduler/outbox/fan-out, database-driven profiles, and SQL indexes tested behind disabled flags         |
|   6 | Relationship CRM                                | Complete locally | Contacts, methods, company links, interactions, reminders, referral requests, best-contact rules, migration compatibility, UI and RLS coverage                             |
|   7 | Applications and packet                         | Complete locally | Sessions, private resume metadata/storage policy, packet, application/stage/follow-up records, return prompt and outcome analytics; Apply never marks Applied              |
|   8 | Installable PWA                                 | Complete locally | Manifest/icons, narrow service worker, no private response caching, offline/update UI, install and lifecycle tests                                                         |
|   9 | Channel orchestration and Web Push              | Complete locally | Encrypted per-device subscriptions, VAPID delivery, channel/device idempotency, privacy payload, retries and 404/410 cleanup; production/device rollout pending            |
|  10 | Mobile detail and Simplify handoff              | Complete locally | Deep-link recovery, mobile action parity, referral/application packet context, Continue Later/Desktop behavior; physical extension/device checks pending                   |
|  11 | Shared AI extraction and escalation             | Complete locally | Explicit Luna, strict evidence, selective capped Terra, current pricing, cost/budget ledgers and regression evaluator; 300-item human corpus remains a human-labeling gate |
|  12 | Invite-only multi-user foundations              | Complete locally | Individual email route/onboarding and per-user runtime preferences implemented behind disabled flags; custom SMTP/public signup remain out of scope                        |
|  13 | Integrated local certification                  | Complete         | From-zero migration/bootstrap, 311 tests, strengthened coverage floor, focused suites, zero-vulnerability audit, build, and retry-free four-viewport browser suite pass    |
|  14 | Production rollout and seven-day soak           | Pending rollout  | Isolated backup restore passes; requires safe FirstSeen-only deployment, Web Push/iPhone acceptance, then seven consecutive scheduled days                                 |
|  15 | Final evidence audit                            | Pending          | Runs after the soak; current documentation intentionally lists remaining blind spots                                                                                       |

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
5. Broad providers remain sensor-only. Greenhouse, Lever, Ashby, Recruitee, Pinpoint, and reviewed
   structured sources are implemented official paths. LinkedIn/Indeed/Glassdoor scraping is absent.
6. Slack uses the shared freshness policy. Immediate alerts require reliable official/reopening age
   ≤24h, Hot/Strong, urgency ≥85, and Active action. Digest is since the previous delivery, ≤7d,
   grouped Just posted/New/Recent, and skips empty.
7. The active queue requires current deterministic eligibility and ranking versions. This hides
   stale-policy recommendations during rollout instead of exposing them before source refresh.
   Explicit unsupported-country remote restrictions are hard exclusions; ambiguous US restrictions
   still route Review.

## Local release evidence

- A clean `supabase db reset --local --no-seed` applied every migration through
  `20260804162200_shared_extraction_escalation.sql`; `pnpm db:bootstrap` then created the local owner,
  database-backed candidate profile/preferences, and browser fixture from zero.
- Formatting, zero-warning lint, strict types, all 311 tests in 49 files, coverage, focused
  connector/evaluation/worker/PWA/security/load suites, zero-vulnerability audit, and optimized
  build pass.
- Coverage: 88.21% statements, 77.65% branches, 89.76% functions, and 89.63% lines. Configuration
  now enforces at least the prior-release baseline (87.15/77.45/88.98/89.21) so future expansion
  cannot silently lower it.
- Playwright: 17 passed and three intentional viewport-independent skips in approximately three
  minutes, with retries disabled at 390×844, 768×1024, 1440×900, and 1920×1080. Console, page,
  unexpected response, persistence, application, relationship, and Axe observers remained clean.
- Real providers: Greenhouse Figma 177/open, Lever Palantir 100 paginated/open, Ashby Linear 24/open,
  Recruitee amperecloud 5/open and xneelo 3/open, Pinpoint workwithus 3/open and wealthwizards
  3/open. An oversized TransPerfect response was safely rejected by the byte limit rather than
  partially accepted.
- Brave-only discovery smoke returned seven candidates and six directly resolvable official URLs;
  the disabled Adzuna provider was not instantiated or contacted. OpenAI explicit Luna evidence
  validation passed (1,204 input/1,340 output tokens). The labelled Slack check returned HTTP 200.
- Real app plus Inngest run finalized 176 official Figma listings successfully. Redelivery of the
  identical occurrence kept exactly one scan row and produced no unresolved dead letter.

## Production release evidence

- The eleven additive Daily-Driver migrations through `20260804162400` applied to guarded dedicated
  FirstSeen ref `tlhwxayhjamopnnlroke`. The read-only verifier reports 52 backfilled organizations/
  global sources, zero private workflow tables without RLS, no browser read privilege on global raw
  observations, and the latest migration present. New rollout flags remain opt-in.
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
- The verified pre-migration backup set remains protected outside the repository as a short-term
  rollback artifact. Never copy or commit it; remove it after the desired rollback-retention window.
- The protected roles/schema/data set restored successfully into a separately named disposable
  PostgreSQL database. Validation found 33 public tables, one Auth user, 37 companies, 2,368 jobs,
  2,828 snapshots and eligibility decisions, 5,890 recommendations, 71 queue states, and zero
  unvalidated constraints. The disposable database was deleted; the mode-600 source artifacts were
  retained unchanged.
- Preserve stale jobs and all user history. Operational monitoring must continue to warn rather than
  silently weakening priority cadence when capacity approaches provider quotas.
- A previously exposed Vercel token was already considered compromised in the original release and
  must remain revoked/replaced provider-side; do not use it if still present in an ignored file.
- Optional Sentry remains unnecessary without a DSN/project; Vercel, Inngest, operations data, and
  provider dashboards are the production diagnostics.

## Gates not yet claimed

- There is no verified seven-day Daily-Driver production soak yet. One successful digest and
  earlier source replay are baseline evidence, not a substitute for the required soak.
- Real iPhone Home Screen installation and Apple Push delivery require the owner's physical iPhone;
  Chromium service-worker tests cannot prove Apple delivery.
- The 300-listing human-labeled AI corpus and 85% independent accepted-market recall target require
  genuine independent labels/observations. Tooling is implemented, but no labels are fabricated.
- Licensed Coresignal/Lightcast testing, Brave commercial storage rights, written Adzuna permission,
  custom SMTP, paid plans, and public signup remain unauthorized and disabled. They do not block the
  private personal release unless capacity or an external beta is requested.
