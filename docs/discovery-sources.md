# FirstSeen discovery sources

## Authority policy

An official employer or ATS listing is authoritative. Search providers, aggregators, startup
boards, and public feeds are discovery sensors only: their snippets, labels, age, location, and
descriptions cannot directly create a canonical job, recommendation, queue item, closure, or alert.
FirstSeen promotes only a URL that resolves to a supported official source, then fetches the actual
description there.

The system does not scrape or automate LinkedIn/Indeed, authenticated sessions, CAPTCHAs, blocked
pages, robots/anti-bot evasions, or hidden/private APIs. Unsupported sources remain visible for
manual review rather than being parsed aggressively.

## Implemented official connectors

| Source           | Compliant mechanism                                                                                                                                                    | Pagination/change/closure                                                      | Status                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------- |
| Greenhouse       | Public Job Board GET endpoints documented by [Greenhouse](https://developers.greenhouse.io/job-board.html)                                                             | Board response, conditions when supplied, authoritative IDs; successful misses | Implemented + live smoke     |
| Lever            | Public published postings documented by the [Lever Postings API](https://github.com/lever/postings-api)                                                                | Limit/skip pagination, posting IDs, successful misses                          | Implemented + live smoke     |
| Ashby            | Public job-board endpoint documented by [Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api)                                                            | Board response, job IDs, successful misses                                     | Implemented + live smoke     |
| Employer JSON-LD | Public `JobPosting` structured data following [Google's employer-page specification](https://developers.google.com/search/docs/appearance/structured-data/job-posting) | Conditional page fetch, reviewed same-host links, conservative confidence      | Implemented + contract tests |

Public structured endpoints are read with ordinary GET requests, explicit user agent, host pacing,
bounded pagination, conditional metadata where supported, timeouts, retries/backoff, response size
limits, and safe-host validation. A connector never interprets one network failure as a closed job.

## Compared but not enabled without authorization

| Source              | Current feasibility                                                                                                                                                                                                  | FirstSeen policy                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| SmartRecruiters     | Its [Posting API overview](https://developers.smartrecruiters.com/docs/posting-api) says Posting resources support API-key authentication, not OAuth.                                                                | Connector contract exists, but stays unsupported until a legitimate customer key is available. JSON-LD may be used only on a reviewed employer page. |
| Workday             | [Workday's API overview](https://developer.workday.com/api-overview) describes customer/tenant integrations; there is no documented universal cross-tenant public careers contract suitable for arbitrary employers. | Add only an employer-specific approved adapter or reviewed public JSON-LD. No guessed `wday` private endpoints.                                      |
| iCIMS               | Job Portal APIs are customer/vendor authenticated.                                                                                                                                                                   | Require authorized access or reviewed employer JSON-LD; otherwise manual.                                                                            |
| Jobvite             | The official [Job Feed API](https://careers.jobvite.com/careersite/job_feed_api.html) requires a key/secret and has provider limits.                                                                                 | Enable only with an authorized employer/feed credential; otherwise JSON-LD/manual.                                                                   |
| Custom career pages | HTML varies and can be legally/technically unsuitable.                                                                                                                                                               | Per-host review, public page permission, stable structured data, and connector contract tests before enablement. No generic crawler.                 |

This conservative policy sacrifices some coverage for high precision, stable operation, and source
compliance. New connectors plug into the same contract and cannot bypass official verification.

## Broad discovery sensors

### Brave Search

[Brave Search API](https://brave.com/search/api/) supplies official ATS URL candidates. The current
Base plan is $5 per 1,000 requests with $5 monthly credits and 50 QPS. FirstSeen uses about 720
requests/month at the initial schedule, paces far below QPS, records request usage, and does not
publish or persist a searchable copy of Brave result content. Only the candidate URL plus minimal
provisional evidence survives until official verification.

### Adzuna

Adzuna is a secondary sensor. Its [API terms](https://developer.adzuna.com/docs/terms_of_service)
permit the configured personal research use and specify default quotas of 25/minute, 250/day,
1,000/week, and 2,500/month. Initial usage is about 720/month. FirstSeen does not republish or
display an Adzuna vacancy: it keeps provider/count diagnostics and advances only a supported
official ATS URL, so displayed vacancy content/source attribution is the official employer. If the
product becomes public or displays Adzuna data, its attribution and licensing requirements must be
re-reviewed first.

Both providers have an application-enforced 900-request monthly breaker. Each request is recorded
idempotently; one provider's exception is isolated and the other still runs. Query rotation covers
accepted locations, remote work, entry-level experience, preferred role families, and supported ATS
domains rather than generic high-competition board pages.

## Connector contract

Every connector supplies `discover(source, context)` and `verify(source, officialUrl, externalId,
context)`, a stable kind/version, and normalized listings with IDs, requisition, title, plain-text
description, official/apply URLs, locations, workplace/employment, posted time/confidence, salary,
source confidence, and safe metadata.

Required behavior:

- Bounded pagination with explicit cursor and hard page limit.
- Conditional first-page request when the provider exposes ETag/Last-Modified; 304 means no work.
- Per-request timeout, safe retry classification, exponential backoff/jitter, per-host rate pacing,
  and bounded concurrency.
- Strict provider schemas; malformed records are skipped or fail safely with an observable code.
- Official verify states Open, Closed, or Uncertain. Uncertain never becomes closure/exclusion.
- Full successful discovery supplies the only closure-miss evidence.
- Parsing and posted/source confidence accompany facts.
- Versioned registration and policy review; unsupported kinds return a safe diagnostic.
- Contract tests cover pagination, normalization, 304, 404/410, malformed payloads, rate limiting,
  retries, and same-host official URL rules.

## Expansion strategy

Near-term coverage grows by adding high-value employers to the watchlist and implementing approved
structured adapters, not by crawling hundreds of arbitrary sites hourly. Broad sensors continually
surface supported ATS tenants. A provisional discovered company starts at four-hour cadence and is
promoted to priority 3 monitoring only after at least one official role is analyzed. This focuses
future scans on companies demonstrably relevant to the candidate while keeping network/AI cost
bounded.
