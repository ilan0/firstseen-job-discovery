# FirstSeen implementation plan and evidence

Original system approved 2026-08-03 and deployed. Freshness-first overhaul approved 2026-08-04.
Daily-Driver expansion approved and implemented locally 2026-08-04. This living record
distinguishes verified evidence from pending production, temporal, licensed-provider, and
physical-device work.

## Daily-Driver master-plan milestones

|   # | Milestone                                       | Status           | Objective evidence or remaining gate                                                                                                                                                               |
| --: | ----------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   0 | Baseline/compliance containment                 | Complete locally | Brave result fields removed from persistence; Adzuna promotion disabled by provider policy; backup/token discrepancies documented                                                                  |
|   1 | Policy, contracts, and benchmark foundation     | Complete locally | Versioned provider capabilities/licenses and minimized URL-hash coverage benchmarks implemented; no fabricated independent recall claim                                                            |
|   2 | Detection, redirects, authority, query overhaul | Complete locally | Twelve stable cohorts; DNS-pinned, per-hop SSRF-safe redirects; organization authority contracts; custom JSON-LD independently verified                                                            |
|   3 | Public ATS connectors                           | Complete locally | Greenhouse, Lever, Ashby, Recruitee, and Pinpoint contract and live bounded smoke checks pass                                                                                                      |
|   4 | Reviewed structured/licensed sensor foundation  | Partial          | Reviewed JSON-LD/RSS/Atom/sitemap contracts implemented; licensed-vendor bakeoff awaits a user-authorized account/contract                                                                         |
|   5 | Shared supply and private overlays              | Complete locally | Additive global schema/backfill/dual write; fair scheduler/outbox; strictest shared watcher cadence; per-snapshot extraction and per-user ranking events; DB-driven profiles                       |
|   6 | Relationship CRM                                | Complete locally | Contacts, methods, company links, interactions, reminders, referral requests, best-contact rules, migration compatibility, UI and RLS coverage                                                     |
|   7 | Applications and packet                         | Complete locally | Sessions, private resume metadata/storage policy, packet, application/stage/follow-up records, return prompt and outcome analytics; Apply never marks Applied                                      |
|   8 | Installable PWA                                 | Complete locally | Manifest/icons, narrow service worker, no private response caching, offline/update UI, install and lifecycle tests                                                                                 |
|   9 | Channel orchestration and Web Push              | Complete locally | Encrypted per-device subscriptions, channel/device idempotency, bounded retries, unknown-outcome dead letters, replay, and 404/410 cleanup; device rollout pending                                 |
|  10 | Mobile detail and Simplify handoff              | Complete locally | Deep-link recovery, mobile action parity, referral/application packet context, Continue Later/Desktop behavior; physical extension/device checks pending                                           |
|  11 | Shared AI extraction and escalation             | Complete locally | Explicit Luna, strict evidence, durable paid-call steps, selective capped Terra, current pricing, cost/budget ledgers and regression evaluator; 300-item corpus remains a human-labeling gate      |
|  12 | Invite-only multi-user foundations              | Complete locally | Individual email route/onboarding and per-user runtime preferences implemented behind disabled flags; custom SMTP/public signup remain out of scope                                                |
|  13 | Integrated local certification                  | Complete         | From-zero migration/bootstrap, 386 tests, strengthened coverage floor, focused suites, zero-vulnerability audit, build, and retry-free four-viewport browser suite pass                            |
|  14 | Production rollout and seven-day soak           | Soak in progress | FirstSeen-only migration/deployment, worker registration, current-policy replay, provider/Slack smokes, and production browser audit pass; seven-day temporal gate and physical iPhone Push remain |
|  15 | Final evidence audit                            | In progress      | Release evidence is reconciled below; the final temporal certification runs after the seven-day soak                                                                                               |

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
8. Connector and redirect requests pin each connection to the same public DNS answer that passed
   validation, then resolve and validate again at every redirect hop. IPv4/IPv6 private,
   transition, protocol-assignment, documentation, multicast, non-default-port, credentialed,
   oversized, and missing/unsupported-content-type destinations fail closed. A DNS-rebinding
   regression test proves that a second-hop private answer is rejected before another request.
9. Legacy CRM company identity prefers an attached verified global source, then an exact canonical
   domain. It never merges unrelated organizations solely because their normalized names match.
10. A global scan now ends after the one authoritative fetch, canonical ingest, lifecycle update,
    and durable extraction-event fan-out. Candidate-neutral extraction is serialized per snapshot;
    personalized deterministic analysis is retried per user with bounded concurrency. New source
    attachments and profile changes enqueue targeted rematching, while old personalized projections
    are invalidated so unchanged official descriptions cannot preserve stale candidate rules.
    Failed extraction cache rows and released Luna/Terra reservations are safely reusable on retry.
11. Candidate-settings updates commit their rematch request through the existing private outbox before
    attempting immediate Inngest delivery. A five-minute dispatcher recovers a failed delivery, and
    snapshot-pinned legacy rematching keeps pre-rollout recommendations profile-driven without network
    refetches. Queue actions update legacy and global private state in the same database transaction.
12. Shared source cadence is recomputed from every active watcher after interest, referral, follow,
    removal, or CRM archival changes. An `agreed` referral is active demand. The strictest watcher
    wins without duplicate source fetches, and an overdue scan is never postponed by promotion.
    Demand refresh also preserves an operationally disabled schedule, so private actions cannot
    reactivate a quarantined global source.
13. Reviewed sitemap patterns reject repetition and advanced regular-expression features, structured
    posting URLs cannot escape the exact verified HTTPS host, expired `validThrough` listings close
    explicitly, and compressed IPv6 loopback addresses fail the public-address gate.
14. Web Push channel/subscription creation is race-safe. Partial unique indexes enforce exactly one
    global notification preference and one per-organization preference per channel, including the
    otherwise-duplicate nullable global scope.
15. Slack and Web Push distinguish provider rejection from post-acceptance persistence. Bounded retry
    exhaustion and permanent provider failures create redacted, owner-scoped dead letters. A stale
    `sending` claim is treated as unknown outcome and requires explicit replay, preventing an
    automatic duplicate notification. Successful replay resolves the same durable recovery record.
16. Routine and escalation OpenAI calls run in their own memoized Inngest steps. Budget reservation,
    provider work, settlement, and extraction persistence are separate recovery boundaries, so a
    downstream database failure reuses the accepted response instead of repeating paid work. A
    stable client request trace is attached to each validation attempt, and usage from every
    accepted validation response is included in cost accounting.
17. Feed cards and job details project freshness-sensitive rank fields at read time. A previously
    Hot recommendation automatically becomes Strong after the 24-hour freshness boundary, while
    freshness, competition proxy, urgency, headline, and routing explanation age together without a
    source rescan or rewriting stored recommendation history.
18. Synthetic browser-fixture sources are explicitly network-disabled. Manual and scheduled local
    scans record an observable successful skip instead of contacting invented ATS tenants, creating
    false source failures, or producing dead letters.

## Local release evidence

- A clean `supabase db reset --local` applied every migration through
  `20260804162800_notification_preference_integrity.sql`; `pnpm db:bootstrap` then created the local owner,
  database-backed candidate profile/preferences, and browser fixture from zero.
- Formatting, zero-warning lint, strict types, all 386 tests in 65 files, coverage, focused
  connector/evaluation/worker/PWA/security/load suites, zero-vulnerability audit, and optimized
  build pass.
- Coverage: 89.31% statements, 78.43% branches, 90.44% functions, and 91.02% lines. Configuration
  now enforces at least the prior-release baseline (87.15/77.45/88.98/89.21) so future expansion
  cannot silently lower it.
- A real local Next.js/Inngest run exercised both manual and scheduled synthetic source scans. Each
  completed as a zero-observation `network_disabled` success with zero active source errors and zero
  unresolved dead letters.
- Playwright: 17 passed and three intentional viewport-independent skips in approximately three
  minutes, with retries disabled at 390×844, 768×1024, 1440×900, and 1920×1080. Console, page,
  unexpected response, persistence, application, relationship, and Axe observers remained clean.
- Real providers: Greenhouse Figma 176/open, Lever Palantir 100 paginated/open, Ashby Linear 25/open,
  Recruitee amperecloud 5/open and xneelo 3/open, Pinpoint workwithus 3/open and wealthwizards
  3/open. An oversized TransPerfect response was safely rejected by the byte limit rather than
  partially accepted.
- Brave-only discovery smoke returned six candidates and six directly resolvable official URLs;
  the disabled Adzuna provider was not instantiated or contacted. OpenAI explicit Luna evidence
  validation passed (1,204 input/1,139 output tokens). The labelled Slack check returned HTTP 200.
- Real app plus Inngest run finalized 176 official Figma listings successfully. Redelivery of the
  identical occurrence kept exactly one scan row and produced no unresolved dead letter.

## Production release evidence

- The additive Daily-Driver migrations through
  `20260804162800_notification_preference_integrity.sql` applied to guarded dedicated FirstSeen ref
  `tlhwxayhjamopnnlroke`. The read-only verifier reports 55 organizations, 56 global sources, zero
  private workflow tables without RLS, no browser read privilege on global raw observations or the
  global outbox, and the latest migration and integrity indexes present.
- A protected logical backup was created outside the repository and its roles, schema, and data
  artifacts were verified non-empty before migration. All five migrations are present on dedicated
  FirstSeen Supabase ref `tlhwxayhjamopnnlroke`; the ProofCheck project was not touched.
- GitHub `main` and the canonical Vercel deployment at
  `https://firstseen-job-discovery-tau.vercel.app` contain the Daily-Driver release. Inngest accepted
  the production app registration after its total concurrency was bounded to the Hobby-plan limit.
- Current-policy targeted rematching accepted 72 active open queue occurrences. At the final release
  check, production had 52 active official sources, 2,933 open global jobs, 2,681 open private jobs,
  57 successful global scans in the prior two hours, and zero active-source errors, unresolved dead
  letters, recent worker failures, failed deliveries, or global/private outbox backlog.
- The authenticated default seven-day feed contains nine verified, current-policy jobs. Production
  includes separate New and Recent sections and never derives posting freshness from sensor text.
  The earlier foreign-only Sweden regression remains deterministically excluded.
- Authenticated browser validation confirmed a seven-day/newest-official default, age sections,
  URL-restored filters/sorts, separate My/Discovered company scopes, explicit date provenance, and
  explainable dimensions. No production browser warning or error remained.
- The 2026-08-04 morning Slack digest delivered once at 8:00:04 AM Eastern with eight jobs. There
  were no duplicate idempotency groups and no qualifying under-24-hour Hot/Strong job requiring an
  immediate production alert.
- The final canonical remote-build deployment returned no HTTP 5xx log entries in the inspected
  45-minute window. Authenticated browser inspection produced no console errors or warnings.

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
