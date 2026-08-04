# FirstSeen discovery sources

## Authority and rights policy

Only an official employer or official ATS listing is authoritative. Search providers,
aggregators, startup boards, public indexes, and licensed datasets are sensors. Their snippets,
labels, age, location, and descriptions cannot create a job, decision, recommendation, closure, or
alert. A candidate advances only after FirstSeen independently fetches and validates official facts.

An ATS hostname or tenant display name does not prove employer authority. Registration requires a
provider/tenant identity plus canonical employer-domain evidence, consistent official structured
`hiringOrganization`, or explicit source review. Ambiguous candidates are quarantined.

Every provider has a service-only rights record for request, transient processing, persistence,
display, retention, and termination behavior. An unknown or denied right fails closed. FirstSeen
does not automate LinkedIn, Indeed, Glassdoor, authenticated sessions, CAPTCHAs, anti-bot evasion,
or undocumented/private ATS APIs.

## Implemented official connectors

| Source            | Mechanism                                                                | Lifecycle policy                                      | Verification                               |
| ----------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------ |
| Greenhouse        | Public anonymous Job Board GET API                                       | Complete board IDs and successful misses              | Contract + live smoke                      |
| Lever             | Public Postings API                                                      | Exhaust limit/skip pagination before misses           | Contract + live smoke                      |
| Ashby             | Public Job Board API                                                     | Published IDs, locations, workplace/type/compensation | Contract + live smoke                      |
| Recruitee         | Anonymous Careers Site API published offers                              | Complete offer feed only                              | Contract + two live tenants                |
| Pinpoint          | Public `postings.json`; RSS-compatible fallback                          | Complete documented feed only                         | Contract + two live tenants                |
| Reviewed JSON-LD  | Public leaf page with valid `JobPosting`                                 | Reverify leaf; 404/410/explicit close                 | Contract; broad page independently checked |
| Reviewed RSS/Atom | Public employer feed after source policy review                          | Complete feed or explicit leaf closure                | Contract fixtures                          |
| Reviewed sitemap  | URL discovery only; leaf still requires official structured verification | Sitemap absence alone never closes                    | Contract fixtures                          |

Public endpoints use ordinary GET requests with explicit user agent, host pacing, bounded pagination,
conditional metadata where supported, explicit content-type and byte limits, timeouts,
retry/backoff, and public-host validation. An incomplete, malformed, rate-limited, timed-out, or
failed run supplies no closure evidence. Reopening is a new lifecycle occurrence and never rewrites
the original posting date.

## Detection, redirects, and query coverage

All twelve role/location cohorts run every four hours: three role clusters across South Florida,
DMV/Fairfax, New York City, and compatible US remote work. Clusters include general SWE/developer,
full-stack/backend/frontend, and AI/applied-AI/ML engineering with junior, associate, early-career,
new-grad, and Engineer I vocabulary. No bundle waits through a sixteen-hour rotation.

Permitted intermediary URLs are resolved with at most five hops and an eight-second redirect
timeout. Every hop is HTTPS, public-IP DNS is revalidated, credentials and non-default ports are
rejected, IDNs are normalized, loops fail, and redirect bodies/content types are bounded. The final
source still requires independent company authority and connector validation. Unsafe, ambiguous, or
cross-company candidates are quarantined individually.

## Broad discovery sensors

### Brave Search

Brave is the active URL sensor. Standard terms restrict storage/caching of Search Results, so
FirstSeen handles titles, snippets, and result fields transiently and does not include them in
durable events. Only facts independently obtained from a verified official source are persisted.
The request ledger stores operation units/cost and safe counts, not a searchable result copy.
Commercial storage/display requires explicit rights beyond the standard plan.

The current standard rate is $5 per 1,000 requests with a $5 monthly credit. A database-backed
breaker and idempotent claims prevent duplicate workflow delivery from making the same billed
request.

### Adzuna

Adzuna automated promotion is disabled. Its default API terms state that API users direct queries
through Adzuna rather than contact third-party content providers, which conflicts with automatic
redirect resolution and offsite official verification. No default discovery run instantiates or
contacts Adzuna. Re-enablement requires written permission and an activated provider-rights record.

### Licensed supply candidates

Coresignal and Lightcast are represented only by a provider-neutral benchmark interface. No
production dependency, request, purchase, or contractual assumption exists. A future user-approved
bakeoff must compare accepted-market official-link recall, freshness, duplicates, permitted
storage/display, termination duties, and cost. Licensed descriptions remain sensors and never
replace employer content.

## Not enabled without legitimate access

| Family                             | Reason                                                  | FirstSeen treatment                                                                                  |
| ---------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| SmartRecruiters                    | Posting API requires a legitimate API key               | Conditional official connector only after authorized access                                          |
| Teamtailor                         | Scoped tenant token                                     | Employer-provided public-scoped token only                                                           |
| iCIMS                              | Job Portal API uses customer/vendor authentication      | Reviewed public structured pages or licensed access                                                  |
| JazzHR/Jobvite                     | Feed/partner credentials and terms                      | Explicit licensed feed only                                                                          |
| BambooHR/Rippling/SAP/Oracle/Taleo | Customer or partner APIs                                | Reviewed public employer pages only                                                                  |
| Workday                            | No verified documented anonymous cross-employer job API | Public structured employer pages or licensed URL sensor; never guessed CXS endpoints                 |
| Custom pages                       | Legality and structure vary                             | Per-source policy, employer authority, parser fixtures, and closure method; no arbitrary DOM crawler |

## Connector contract

Every connector has a stable kind/version and returns normalized authoritative IDs, title,
description, official/apply URLs, requisition, locations, workplace/employment, posted-time value and
confidence, salary, source confidence, material metadata, pagination completeness, validators, and
safe diagnostics.

Required behavior:

- Bounded pagination with explicit cursor/hard page limit and honest completeness.
- Conditional first request where supported; policy reprocessing may bypass a 304 when descriptions
  are required.
- Strict schemas, public-host allowlists, content-type/size/time bounds, paced retries, and bounded
  concurrency.
- Unchanged observations preserve identity/hash evidence without repeatedly storing descriptions.
- `Open`, `Closed`, or `Uncertain` verification; Uncertain never becomes closure evidence.
- Closure only from complete authoritative absence or verified official terminal state.
- Versioned normalization and posted/source confidence with material-change fingerprints.
- Contract coverage for pagination, duplicates, 304, malformed rows, 429, 4xx/5xx, timeout,
  oversize, incomplete fetch, closure, and reopening.

## Monitoring and honest coverage

Interested or active-referral demand is Priority (15 minutes), other personal demand Standard (60),
recent viable discovered demand Warm (60), and other verified automatic supply Cold (240). New
provisional official sources verify immediately; dismissed/unsafe/quarantined sources do not scan.
Review-only, excluded, stale, or unrelated jobs cannot warm a source. Capacity may stop new Cold
admission but never silently reduces Priority cadence.

FirstSeen measures supported-connector contract recall and maintains a minimized independent
benchmark using URL hashes, source family, eligibility labels, and observation times. It never
claims a literal union of every board-exclusive posting. The 85% accepted-market recall target is a
release gate only after genuine independent observations exist.
