# FirstSeen test report

Release candidate tested 2026-08-03 on macOS with Node 22.23.2, pnpm 11.9.0, local Supabase
PostgreSQL/Auth in Docker, Next.js 16.2.12, React 19.2.8, and Inngest CLI 1.40.0.

## Final local release gate

| Check                           | Command                                                                | Result                         |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------------ |
| Formatting                      | `pnpm format:check`                                                    | Pass, all tracked files        |
| Lint                            | `pnpm lint`                                                            | Pass, zero warnings            |
| Strict TypeScript               | `pnpm typecheck`                                                       | Pass                           |
| Unit/component/contract tests   | `pnpm test`                                                            | 113 passed; 7 DB-gated skipped |
| PostgreSQL/Auth/RLS integration | `RUN_DATABASE_TESTS=true pnpm vitest run src/db/*.integration.test.ts` | 7 passed in 5 files            |
| Production compile              | `pnpm build`                                                           | Pass; 12 app routes + Proxy    |
| Real browser E2E/Axe            | `pnpm test:e2e`                                                        | 12 passed, 59.9 seconds        |

## Test coverage by risk

| Area                     | Evidence                                                                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hard eligibility         | Required vs preferred experience, ranges and >2 exclusion; full-time vs other employment; clearance, ability to obtain, negative phrases, Public Trust, ordinary background checks; sponsorship; accepted/uncertain/outside locations, NYC vs NJ, remote restrictions; role families |
| AI boundary              | Strict structured schema, refused/malformed output, evidence validation, deterministic merge authority, prompt hash/version, injection-like description instructions, token/cost calculation, budget failure→Review                                                                  |
| Connectors               | Greenhouse/Lever/Ashby normalization and live smoke; JSON-LD parsing/same-host rules; pagination, 304, malformed records, retries/backoff, rate pacing, error isolation, verify open/closed/uncertain, unsupported providers                                                         |
| Identity/lifecycle       | URL/source/fallback fingerprints, canonical dedupe, idempotent ingest, material hash/snapshot only on change, first/last seen, successful misses, possible close/close/reopen, stale dynamic urgency, closed hidden only from Active                                                 |
| Durable work             | Watchlist lease, stable scan key, source fan-out, changed-only observation IDs, duplicate-safe rows, partial-failure retry, dead-letter capture/replay, notification uniqueness, retention                                                                                           |
| Authentication/security  | Supabase Auth, single-owner checks, anon/cross-user RLS denial, server-write model, HMAC rate limit atomics/reset/clear, safe URL/SSRF rules, headers/CSP build, model-output validation                                                                                             |
| Product actions          | Sign-in/out, band/referral filters, details and all dimensions, Save→reload→Restore, route revalidation, watch URL error recovery, Apply lifecycle guards, settings success, JSON export headers/data                                                                                |
| Slack/time               | Exact IANA time-zone hour, quiet-hour deferral with original payload, digest local-date uniqueness, retry/delivery dedupe, closed job exclusion                                                                                                                                      |
| Accessibility/responsive | Main content Axe scan on every core route; labelled inputs/actions; focus/keyboard semantics; visible two-row mobile navigation; long cards/details; no horizontal overflow                                                                                                          |

## Browser matrix

The same three scenarios ran serially at each required viewport:

| Viewport  | Portal/action flow | Core routes + Axe/export/settings | Responsive visual capture |
| --------- | ------------------ | --------------------------------- | ------------------------- |
| 390×844   | Pass               | Pass                              | Pass                      |
| 768×1024  | Pass               | Pass                              | Pass                      |
| 1440×900  | Pass               | Pass                              | Pass                      |
| 1920×1080 | Pass               | Pass                              | Pass                      |

Failure observers checked uncaught page exceptions, browser console errors, failed requests, and
HTTP 5xx responses. None occurred. Responsive screenshots were visually inspected. A separate live
authenticated inspection confirmed expected cards/headings, no horizontal overflow, and no console
errors/warnings. Server request logs and persisted queue/settings rows were checked after actions.

## Real-provider smoke evidence

| Provider     | Result                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------- |
| Greenhouse   | Pass; 178 public Figma listings normalized                                                     |
| Lever        | Pass; 100 public Palantir listings with pagination                                             |
| Ashby        | Pass; 23 public Linear listings normalized                                                     |
| Brave Search | Pass; 11 candidates in credential check                                                        |
| Adzuna       | Pass; valid credentialed response, zero candidates for narrow check                            |
| OpenAI       | Pass; configured `gpt-5.6-luna` structured analysis accepted                                   |
| Slack        | Pass; labelled setup-check message, HTTP 200                                                   |
| Inngest      | Pass; functions registered; notification trace completed; no-change source fast path completed |

The durable changed-listing path was tested against a real public source by locally forcing one
material hash stale. The first run exposed a timestamp-driver bug in the reopen expression. After
fixing the root cause, the same durable run resumed and succeeded with six discovered, exactly one
changed/analyzed, zero failures, and no exceptional duplicate alert. A database regression test also
caught and fixed the same class of raw SQL timestamp binding in security throttling.

## Remaining production validation

No production claim is made yet. Dedicated Supabase/GitHub/Vercel creation is externally blocked as
recorded in `PLAN.md`. Once those accounts are remediated, the release still requires cloud
migrations/RLS verification, encrypted environment review, Inngest sync, authenticated production
browser/provider/Slack checks, telemetry/database inspection, backup and rollback rehearsal, and a
24-hour scheduled-scan/digest soak. These results must be appended rather than inferred from local
success.
