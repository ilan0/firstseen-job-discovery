# FirstSeen matching rules

Matching is versioned, deterministic where eligibility matters, and explicit about uncertainty.
Runtime candidate facts and preferences are loaded from the authenticated user's database records;
`src/config/candidate.ts` is seed input only. Pure rules live under `src/domain/eligibility`, and
changes require unit and database regression tests.

## Processing order

1. Normalize the official listing and extract conservative facts from the title, description,
   employment field, locations, and workplace field.
2. Apply deterministic hard rules. A proven hard exclusion ends analysis before OpenAI.
3. For plausible software roles only, reserve durable AI budget and request one candidate-neutral
   Luna extraction per global description snapshot.
4. Validate the schema and verify quoted evidence against the supplied description. Merge only
   supported facts; deterministic evidence takes precedence on hard exclusions.
5. If a hard field is low-confidence, conflicts with regex, contains complex alternatives, or
   fails validation, selectively request a capped Terra second pass and reconcile evidence.
6. Run deterministic eligibility separately for each user. Unknown/contradictory hard facts produce
   Review.
7. Calculate and persist separate ranking dimensions, route the queue, and evaluate notification
   eligibility in deterministic code.

AI cannot change lifecycle, deduplication, queue state transitions, hard exclusion semantics, or
notification idempotency.

Freshness-sensitive display fields are projected from the current clock. Stored recommendation
history remains immutable, while a stale Hot label is demoted and freshness, competition proxy,
urgency, headline, and routing explanation are recomputed together on feed/detail reads.

Routine extraction receives no candidate profile, contact/referral PII, resume, application state,
or notification device data. Its cache identity includes snapshot, model, schema, prompt hash, and
reasoning configuration. Provider calls and persistence use separate durable steps so replay can
reuse a paid response, and every accepted validation attempt contributes to token accounting. Terra
is capped at 10% of analyzed snapshots and 20% of AI spend. A model
refusal, invalid evidence, or unresolved Luna/Terra conflict routes to Review rather than guessing.

## Hard eligibility

| Rule                 | Eligible                                                                            | Ineligible                                                                                                                        | Review                              |
| -------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Employment           | Explicit full-time                                                                  | Part-time, contract, internship, temporary                                                                                        | Missing/contradictory type          |
| Experience           | Required maximum ≤2 years; 0–1 ideal                                                | Required minimum or unbounded explicit requirement >2                                                                             | Ambiguous ranges/phrasing           |
| Preferred experience | Never a hard exclusion by itself                                                    | —                                                                                                                                 | May reduce alignment/confidence     |
| Clearance            | Explicitly no clearance required or no requirement found with sufficient confidence | Active/current clearance, ability/eligibility to obtain, Secret/TS/SCI/polygraph, Public Trust, or equivalent federal suitability | Ambiguous government suitability    |
| Background check     | Ordinary check allowed                                                              | Only if it is actually clearance/suitability                                                                                      | Ambiguous federal language          |
| Sponsorship          | No sponsorship needed; employer restrictions compatible                             | Employer requires an incompatible work status                                                                                     | State/work authorization unclear    |
| Onsite/hybrid        | Configured South Florida, Fairfax-centered DMV, or NYC five boroughs                | Proven outside accepted areas; New Jersey is not NYC                                                                              | City/region too vague               |
| Fully remote         | Employer can employ candidate in compatible US location                             | Proven incompatible state/country/region restriction                                                                              | Allowed states/jurisdiction missing |
| Role                 | Software/AI engineering families are rankable                                       | Proven non-software role is not recommended                                                                                       | Unclear technical family            |
| Salary/industry      | Any salary and industry                                                             | —                                                                                                                                 | Missing salary does not block       |

Foreign-only remote restrictions are recognized from deterministic ISO region names plus common
ATS aliases such as UK, EU, EMEA, APAC, and LATAM. A listing with a compatible US option may pass;
an explicit foreign-only option is excluded, while an unresolved city or “global” jurisdiction
routes to Review rather than guessing.

“Three years preferred” does not equal “three years required.” “Must have 3+ years,” “minimum
three years,” and equivalent required language are hard exclusions. “0–2 years,” “up to two,” and
true new-grad language can pass. Seniority labels are weak signals; actual requirement prose wins.

An obvious Senior/Staff/Principal/Lead/Intermediate/Manager/Director/Head/Architect title with no
explicit compatible required-experience prose is withheld as a title-level fit mismatch, not marked
deterministically ineligible. If the authoritative description explicitly asks for at most two
years, that prose outweighs the inflated label and the role remains rankable.

Negative phrases such as “no clearance required” are handled before positive clearance patterns.
Hard-rule reasons persist evidence and a rule version. If extraction cannot justify the decision,
the row records uncertain fields and routes to Review.

## Role-family preference

Role family is not a global hard filter unless the listing is clearly non-software. Preference is:
general SWE, full stack, backend, frontend, AI engineer, embedded/C, internal tools/automation, then
customer-facing engineering. AI/ML software engineering remains attractive; research roles with
unsupported advanced-degree/experience requirements are filtered by their actual requirements.
Bare industry words such as “AI,” “data,” or “cloud” do not make a title technical; the title must
also identify an engineering/development role before model analysis is allowed. This prevents sales
or product postings at AI companies from consuming budget or entering Review as software roles.

## Explainable dimensions

Each private recommendation persists one row per dimension with value, confidence, evidence,
explanation, and ranking version:

- Skills fit: overlap between required/preferred technologies and resume evidence. Matching accepts
  normalized concrete names and reviewed category equivalents (for example React for “frontend
  frameworks” or PostgreSQL for “databases”). Location, onsite, sponsorship, authorization,
  clearance, and degree conditions are excluded from this dimension and remain in their dedicated
  eligibility facts; they can never create a misleading zero-skills explanation.
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
opaque match score. The versioned Push policy requires open/reopened lifecycle, reliable official
posting/reopening time, deterministic eligibility, Active/unacted state, and occurrence-level
idempotency. Balanced alerts Hot/Strong through 24 hours; preferred-role Possible through six hours;
and eligible Interested/referral-company Hot/Strong/Possible through 24 hours. Company Always may
broaden only to those viable bands and age limit; Mute wins. Neither preferences nor AI can bypass a
hard exclusion. Review and detection-time-only freshness never alert. Closed/uncertain jobs cannot
open through Apply or restore to Active.

## Freshness and lifecycle

- Prefer `reopened_at` for a verified reopening occurrence, then `posted_at` when its source
  confidence is not low; otherwise visibly use `first_seen_at`. Reject malformed timestamps and
  values more than five minutes in the future as anomalous Review-confidence input.
- Shared dynamic boundaries are Fresh <6h, Very fresh ≤24h, Current ≤7d, Aging ≤30d, and Stale
  thereafter. Feed sections are Just posted ≤24h, New ≤3d, Recent ≤7d, and Older ≤30d. The default
  feed uses the first three; only Hot/Strong jobs enter Older exceptional matches.
- Freshness alters the freshness dimension and caps effective urgency at query time so stored scores
  cannot keep an old job hot. FirstSeen discovery never makes an ancient official posting fresh.
- A complete successful source fetch supplies the seen external IDs and URLs. Missing jobs advance
  a connector-specific successful-miss lifecycle; failed/incomplete fetches do nothing to closure.
- A seen possibly-closed/closed job returns to Open, clears misses/closure timestamps, and records a
  reopening time. Saved/Applied/Dismissed history is not reset.
- An unchanged reopened description is reranked from the validated cached extraction without a new
  model call. Its reopening alert has a new occurrence identity, while previous user action still
  suppresses an alert.
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
