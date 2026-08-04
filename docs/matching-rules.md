# FirstSeen matching rules

Matching is versioned, deterministic where eligibility matters, and explicit about uncertainty.
The implemented candidate policy is encoded in `src/config/candidate.ts` and pure rules under
`src/domain/eligibility`; changes require unit and database regression tests.

## Processing order

1. Normalize the official listing and extract conservative facts from the title, description,
   employment field, locations, and workplace field.
2. Apply deterministic hard rules. A proven hard exclusion ends analysis before OpenAI.
3. For eligible/review plausible software roles only, reserve durable AI budget and request a
   compact structured extraction.
4. Validate the schema and verify quoted evidence against the supplied description. Merge only
   supported facts; deterministic evidence takes precedence on hard exclusions.
5. Re-run deterministic eligibility. Unknown/contradictory hard facts produce Review.
6. Calculate and persist separate ranking dimensions, route the queue, and evaluate notification
   eligibility in deterministic code.

AI cannot change lifecycle, deduplication, queue state transitions, hard exclusion semantics, or
notification idempotency.

## Hard eligibility

| Rule                 | Eligible                                                                            | Ineligible                                                                                   | Review                              |
| -------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------- |
| Employment           | Explicit full-time                                                                  | Part-time, contract, internship, temporary                                                   | Missing/contradictory type          |
| Experience           | Required maximum ≤2 years; 0–1 ideal                                                | Required minimum or unbounded explicit requirement >2                                        | Ambiguous ranges/phrasing           |
| Preferred experience | Never a hard exclusion by itself                                                    | —                                                                                            | May reduce alignment/confidence     |
| Clearance            | Explicitly no clearance required or no requirement found with sufficient confidence | Active/current clearance, ability/eligibility to obtain, Secret/TS/SCI/polygraph, equivalent | Ambiguous government suitability    |
| Public Trust         | Explicitly not required or no requirement found with sufficient confidence          | Any Public Trust/federal suitability requirement                                             | Ambiguous wording                   |
| Background check     | Ordinary check allowed                                                              | Only if it is actually clearance/suitability                                                 | Ambiguous federal language          |
| Sponsorship          | No sponsorship needed; employer restrictions compatible                             | Employer requires an incompatible work status                                                | State/work authorization unclear    |
| Onsite/hybrid        | Configured South Florida, Fairfax-centered DMV, or NYC five boroughs                | Proven outside accepted areas; New Jersey is not NYC                                         | City/region too vague               |
| Fully remote         | Employer can employ candidate in compatible US location                             | Proven incompatible state/country restriction                                                | Allowed states/jurisdiction missing |
| Role                 | Software/AI engineering families are rankable                                       | Proven non-software role is not recommended                                                  | Unclear technical family            |
| Salary/industry      | Any salary and industry                                                             | —                                                                                            | Missing salary does not block       |

“Three years preferred” does not equal “three years required.” “Must have 3+ years,” “minimum
three years,” and equivalent required language are hard exclusions. “0–2 years,” “up to two,” and
true new-grad language can pass. Seniority labels are weak signals; actual requirement prose wins.

Negative phrases such as “no clearance required” are handled before positive clearance patterns.
Hard-rule reasons persist evidence and a rule version. If extraction cannot justify the decision,
the row records uncertain fields and routes to Review.

## Role-family preference

Role family is not a global hard filter unless the listing is clearly non-software. Preference is:
general SWE, full stack, backend, frontend, AI engineer, embedded/C, internal tools/automation, then
customer-facing engineering. AI/ML software engineering remains attractive; research roles with
unsupported advanced-degree/experience requirements are filtered by their actual requirements.

## Explainable dimensions

Each recommendation persists one row per dimension with value, confidence, evidence, explanation,
and ranking version:

- Skills fit: overlap between required/preferred technologies and resume evidence.
- Required-experience alignment: closeness to 0–1 year, with hard maximum already enforced.
- Role-family alignment: candidate preference above.
- Freshness: reliable posted time when available, otherwise first-seen; ages dynamically.
- Referral advantage: active referral at the company.
- Location eligibility: accepted/remote certainty after hard filtering.
- Competition proxy: freshness, official-direct source, and referral—not fabricated applicant count.
- Extraction confidence: confidence/evidence completeness of normalized facts.
- Source confidence: structured official API versus reviewed structured page.
- Urgency: deterministic synthesis for ordering/alert eligibility, separately visible and dynamically
  capped as a job ages.

Recommendation bands are Hot, Strong, Possible, Review, or Not Recommended. There is no displayed
opaque match score. A Hot alert additionally requires open/reopened lifecycle, urgency at least 85,
a current snapshot, and notification idempotency. Closed/uncertain jobs cannot open through Apply or
restore to Active.

## Freshness and lifecycle

- Prefer `posted_at` only when its source confidence is not low; otherwise use `first_seen_at`.
- Fresh, aging, and stale bands alter the freshness dimension and cap effective urgency at query
  time so stored scores cannot keep an old job hot.
- A complete successful source fetch supplies the seen external IDs and URLs. Missing jobs advance
  a connector-specific successful-miss lifecycle; failed/incomplete fetches do nothing to closure.
- A seen possibly-closed/closed job returns to Open, clears misses/closure timestamps, and records a
  reopening time. Saved/Applied/Dismissed history is not reset.
- A material fingerprint includes title, description, locations, workplace/employment, salary, and
  other application-relevant fields. Cosmetic source metadata does not trigger AI.
- An unchanged listing is deterministically reprocessed when the eligibility or ranking policy
  version changes. A current, schema-validated AI extraction is reused and preserved; identical
  content does not consume model budget again.

## Queue transitions

Allowed owner actions are Active→Saved/Applied/Dismissed, Saved→Active/Applied/Dismissed,
Applied→Saved/Dismissed, and Dismissed→Active/Saved/Applied as defined by the domain transition
table. Each mutation checks owner, lifecycle when restoring, expected row version, writes history,
user action, and audit evidence, then revalidates affected routes. Duplicate/stale submissions fail
safely rather than silently overwriting newer state.
