-- Additive identity links and resumable legacy-to-v2 backfill. No legacy ID changes.

ALTER TYPE public.referral_status ADD VALUE IF NOT EXISTS 'agreed';
ALTER TYPE public.referral_status ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE public.referral_status ADD VALUE IF NOT EXISTS 'completed';

ALTER TABLE public.companies
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.career_sources
  ADD COLUMN global_source_id uuid REFERENCES public.global_career_sources(id) ON DELETE SET NULL;
ALTER TABLE public.canonical_jobs
  ADD COLUMN global_job_id uuid REFERENCES public.global_jobs(id) ON DELETE SET NULL;
ALTER TABLE public.job_description_snapshots
  ADD COLUMN global_snapshot_id uuid REFERENCES public.global_job_snapshots(id) ON DELETE SET NULL;
ALTER TABLE public.contacts ADD COLUMN legacy_referral_id uuid;

CREATE INDEX companies_organization_idx ON public.companies (organization_id);
CREATE INDEX career_sources_global_source_idx ON public.career_sources (global_source_id);
CREATE INDEX canonical_jobs_global_job_idx ON public.canonical_jobs (global_job_id);
CREATE INDEX job_snapshots_global_snapshot_idx
  ON public.job_description_snapshots (global_snapshot_id);
CREATE UNIQUE INDEX contacts_legacy_referral_unique
  ON public.contacts (legacy_referral_id);

INSERT INTO public.organizations (name, normalized_name, canonical_domain)
SELECT min(c.name), c.normalized_name, lower(c.domain)
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.organizations o
  WHERE o.normalized_name = c.normalized_name
    AND o.canonical_domain IS NOT DISTINCT FROM lower(c.domain)
)
GROUP BY c.normalized_name, lower(c.domain);

UPDATE public.companies c
SET organization_id = o.id, updated_at = now()
FROM public.organizations o
WHERE c.organization_id IS NULL
  AND o.normalized_name = c.normalized_name
  AND o.canonical_domain IS NOT DISTINCT FROM lower(c.domain);

INSERT INTO public.organization_domains (
  organization_id, domain, authority_confidence, verified_at, evidence
)
SELECT DISTINCT c.organization_id, lower(c.domain), 90, now(),
  jsonb_build_object('source', 'legacy_company_domain', 'inferred', true)
FROM public.companies c
WHERE c.organization_id IS NOT NULL AND c.domain IS NOT NULL
ON CONFLICT (domain) DO NOTHING;

INSERT INTO public.global_career_sources (
  organization_id, connector_kind, tenant_id, base_url, normalized_url,
  public_config, active, parsing_confidence, etag, last_modified,
  last_attempt_at, last_success_at, last_error_code
)
SELECT DISTINCT ON (s.normalized_url)
  cs.organization_id,
  s.connector_kind,
  r.external_tenant_id,
  s.base_url,
  s.normalized_url,
  s.public_config,
  s.active,
  s.parsing_confidence,
  r.etag,
  r.last_modified,
  s.last_attempt_at,
  s.last_success_at,
  s.last_error_code
FROM public.career_sources s
JOIN public.companies cs ON cs.id = s.company_id
LEFT JOIN public.connector_registrations r ON r.career_source_id = s.id
WHERE cs.organization_id IS NOT NULL
ORDER BY s.normalized_url, s.last_success_at DESC NULLS LAST, s.created_at
ON CONFLICT DO NOTHING;

UPDATE public.career_sources s
SET global_source_id = g.id, updated_at = now()
FROM public.global_career_sources g
WHERE s.global_source_id IS NULL AND g.normalized_url = s.normalized_url;

INSERT INTO public.global_scan_schedules (
  career_source_id, monitoring_tier, cadence_minutes, next_run_at
)
SELECT
  s.global_source_id,
  CASE min(w.cadence_minutes)
    WHEN 15 THEN 'priority'::public.monitoring_tier
    WHEN 60 THEN 'standard'::public.monitoring_tier
    ELSE 'cold'::public.monitoring_tier
  END,
  coalesce(min(w.cadence_minutes), 240),
  coalesce(min(w.next_scan_at), now())
FROM public.career_sources s
LEFT JOIN public.watchlists w ON w.company_id = s.company_id AND w.active
WHERE s.global_source_id IS NOT NULL AND s.active
GROUP BY s.global_source_id
ON CONFLICT (career_source_id) DO UPDATE SET
  monitoring_tier = EXCLUDED.monitoring_tier,
  cadence_minutes = EXCLUDED.cadence_minutes,
  next_run_at = least(public.global_scan_schedules.next_run_at, EXCLUDED.next_run_at);

INSERT INTO public.global_jobs (
  organization_id, authoritative_source_id, external_job_id, requisition_id,
  title, normalized_title, official_url, normalized_official_url, apply_url,
  lifecycle_status, posted_at, posted_at_confidence, first_seen_at, verified_at,
  last_seen_at, possibly_closed_at, closed_at, reopened_at,
  current_material_hash, consecutive_successful_misses, row_version,
  created_at, updated_at
)
SELECT DISTINCT ON (j.normalized_official_url)
  c.organization_id,
  s.global_source_id,
  j.external_job_id,
  j.requisition_id,
  j.title,
  j.normalized_title,
  j.official_url,
  j.normalized_official_url,
  j.official_url,
  j.lifecycle_status,
  j.posted_at,
  j.posted_at_confidence,
  j.first_seen_at,
  j.verified_at,
  j.last_seen_at,
  j.possibly_closed_at,
  j.closed_at,
  j.reopened_at,
  j.current_material_hash,
  j.consecutive_successful_misses,
  j.row_version,
  j.created_at,
  j.updated_at
FROM public.canonical_jobs j
JOIN public.companies c ON c.id = j.company_id
JOIN public.career_sources s ON s.id = j.authoritative_source_id
WHERE c.organization_id IS NOT NULL AND s.global_source_id IS NOT NULL
ORDER BY j.normalized_official_url, j.last_seen_at DESC
ON CONFLICT (normalized_official_url) DO UPDATE SET
  last_seen_at = greatest(public.global_jobs.last_seen_at, EXCLUDED.last_seen_at),
  verified_at = greatest(public.global_jobs.verified_at, EXCLUDED.verified_at),
  updated_at = greatest(public.global_jobs.updated_at, EXCLUDED.updated_at);

UPDATE public.canonical_jobs j
SET global_job_id = g.id, updated_at = now()
FROM public.global_jobs g
WHERE j.global_job_id IS NULL
  AND g.normalized_official_url = j.normalized_official_url;

INSERT INTO public.global_job_source_links (
  job_id, career_source_id, external_job_id, source_url, authoritative,
  first_seen_at, last_seen_at, created_at, updated_at
)
SELECT j.global_job_id, s.global_source_id, l.external_job_id, l.source_url,
  l.authoritative, l.first_seen_at, l.last_seen_at, l.created_at, l.updated_at
FROM public.job_source_links l
JOIN public.canonical_jobs j ON j.id = l.job_id
JOIN public.career_sources s ON s.id = l.career_source_id
WHERE j.global_job_id IS NOT NULL AND s.global_source_id IS NOT NULL
ON CONFLICT (job_id, career_source_id) DO UPDATE SET
  last_seen_at = greatest(public.global_job_source_links.last_seen_at, EXCLUDED.last_seen_at),
  authoritative = public.global_job_source_links.authoritative OR EXCLUDED.authoritative;

INSERT INTO public.global_job_snapshots (
  job_id, material_hash, description_text, normalized_facts,
  material_change_reasons, captured_at, created_at, updated_at
)
SELECT j.global_job_id, s.material_hash, s.description_text, s.normalized_facts,
  s.material_change_reasons, s.captured_at, s.created_at, s.updated_at
FROM public.job_description_snapshots s
JOIN public.canonical_jobs j ON j.id = s.job_id
WHERE j.global_job_id IS NOT NULL
ON CONFLICT (job_id, material_hash) DO NOTHING;

UPDATE public.job_description_snapshots s
SET global_snapshot_id = gs.id, updated_at = now()
FROM public.canonical_jobs j, public.global_job_snapshots gs
WHERE s.global_snapshot_id IS NULL
  AND j.id = s.job_id
  AND gs.job_id = j.global_job_id
  AND gs.material_hash = s.material_hash;

WITH latest AS (
  SELECT DISTINCT ON (s.job_id) s.job_id, s.id, s.material_hash, s.updated_at
  FROM public.global_job_snapshots s
  ORDER BY s.job_id, s.captured_at DESC, s.id DESC
)
UPDATE public.global_jobs g
SET current_snapshot_id = latest.id,
    current_material_hash = latest.material_hash,
    updated_at = greatest(g.updated_at, latest.updated_at)
FROM latest
WHERE latest.job_id = g.id;

INSERT INTO public.global_job_fingerprints (
  job_id, kind, fingerprint, confidence, active, created_at, updated_at
)
SELECT j.global_job_id, f.kind, f.fingerprint, f.confidence, f.active,
  f.created_at, f.updated_at
FROM public.dedupe_fingerprints f
JOIN public.canonical_jobs j ON j.id = f.job_id
WHERE j.global_job_id IS NOT NULL
ON CONFLICT (kind, fingerprint) DO NOTHING;

INSERT INTO public.global_job_lifecycle_events (
  job_id, from_status, to_status, reason, evidence, occurred_at
)
SELECT DISTINCT j.global_job_id, NULL::public.job_lifecycle_status,
  j.lifecycle_status::public.job_lifecycle_status,
  'Legacy lifecycle state backfill',
  jsonb_build_object('inferred', true, 'legacy_job_id', j.id),
  j.updated_at
FROM public.canonical_jobs j
WHERE j.global_job_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.global_job_lifecycle_events e
    WHERE e.job_id = j.global_job_id AND e.reason = 'Legacy lifecycle state backfill'
  );

INSERT INTO public.user_company_follows (
  user_id, organization_id, interested, scope, active, sticky_dismissed,
  notes, created_at, updated_at
)
SELECT c.user_id, c.organization_id, c.interested,
  coalesce(w.scope::text, CASE WHEN c.origin = 'discovered' THEN 'discovered' ELSE 'personal' END),
  coalesce(w.active, c.active), NOT c.active, c.notes, c.created_at, c.updated_at
FROM public.companies c
LEFT JOIN public.watchlists w ON w.company_id = c.id AND w.user_id = c.user_id
WHERE c.organization_id IS NOT NULL
ON CONFLICT (user_id, organization_id) DO UPDATE SET
  interested = EXCLUDED.interested,
  scope = EXCLUDED.scope,
  active = EXCLUDED.active,
  sticky_dismissed = EXCLUDED.sticky_dismissed,
  notes = EXCLUDED.notes,
  updated_at = EXCLUDED.updated_at;

INSERT INTO public.user_job_eligibility (
  user_id, job_id, snapshot_id, outcome, rule_version, reasons,
  evidence, uncertain_fields, evaluated_at, created_at, updated_at
)
SELECT e.user_id, j.global_job_id, s.global_snapshot_id, e.outcome,
  e.rule_version, e.reasons, e.evidence, e.uncertain_fields,
  e.evaluated_at, e.created_at, e.updated_at
FROM public.eligibility_decisions e
JOIN public.canonical_jobs j ON j.id = e.job_id
JOIN public.job_description_snapshots s ON s.id = e.snapshot_id
WHERE j.global_job_id IS NOT NULL AND s.global_snapshot_id IS NOT NULL
ON CONFLICT (user_id, snapshot_id, rule_version) DO UPDATE SET
  outcome = EXCLUDED.outcome,
  reasons = EXCLUDED.reasons,
  evidence = EXCLUDED.evidence,
  uncertain_fields = EXCLUDED.uncertain_fields,
  evaluated_at = EXCLUDED.evaluated_at,
  updated_at = EXCLUDED.updated_at;

INSERT INTO public.user_job_ranking_dimensions (
  user_id, job_id, snapshot_id, dimension, value, confidence,
  explanation, evidence, ranking_version, created_at, updated_at
)
SELECT d.user_id, j.global_job_id, s.global_snapshot_id, d.dimension,
  d.value, d.confidence, d.explanation, d.evidence, d.ranking_version,
  d.created_at, d.updated_at
FROM public.ranking_dimensions d
JOIN public.canonical_jobs j ON j.id = d.job_id
JOIN public.job_description_snapshots s ON s.id = d.snapshot_id
WHERE j.global_job_id IS NOT NULL AND s.global_snapshot_id IS NOT NULL
ON CONFLICT (user_id, snapshot_id, dimension, ranking_version) DO UPDATE SET
  value = EXCLUDED.value,
  confidence = EXCLUDED.confidence,
  explanation = EXCLUDED.explanation,
  evidence = EXCLUDED.evidence,
  updated_at = EXCLUDED.updated_at;

INSERT INTO public.user_recommendations (
  user_id, job_id, snapshot_id, eligibility_id, band, urgency, headline,
  strengths, weaknesses, primary_concern, ranking_version, active,
  recommended_at, created_at, updated_at
)
SELECT r.user_id, j.global_job_id, s.global_snapshot_id, ue.id,
  r.band, r.urgency, r.headline, r.strengths, r.weaknesses,
  coalesce(r.weaknesses->>0, NULL), r.ranking_version, r.active,
  r.recommended_at, r.created_at, r.updated_at
FROM public.recommendations r
JOIN public.canonical_jobs j ON j.id = r.job_id
JOIN public.job_description_snapshots s ON s.id = r.snapshot_id
JOIN public.eligibility_decisions e ON e.id = r.eligibility_decision_id
JOIN public.user_job_eligibility ue
  ON ue.user_id = r.user_id
 AND ue.snapshot_id = s.global_snapshot_id
 AND ue.rule_version = e.rule_version
WHERE j.global_job_id IS NOT NULL AND s.global_snapshot_id IS NOT NULL
ON CONFLICT (user_id, snapshot_id, ranking_version) DO UPDATE SET
  eligibility_id = EXCLUDED.eligibility_id,
  band = EXCLUDED.band,
  urgency = EXCLUDED.urgency,
  headline = EXCLUDED.headline,
  strengths = EXCLUDED.strengths,
  weaknesses = EXCLUDED.weaknesses,
  primary_concern = EXCLUDED.primary_concern,
  active = EXCLUDED.active,
  updated_at = EXCLUDED.updated_at;

INSERT INTO public.user_job_queue_states (
  user_id, job_id, status, row_version, status_changed_at, created_at, updated_at
)
SELECT q.user_id, j.global_job_id, q.status, q.row_version,
  q.status_changed_at, q.created_at, q.updated_at
FROM public.queue_states q
JOIN public.canonical_jobs j ON j.id = q.job_id
WHERE j.global_job_id IS NOT NULL
ON CONFLICT (user_id, job_id) DO UPDATE SET
  status = EXCLUDED.status,
  row_version = EXCLUDED.row_version,
  status_changed_at = EXCLUDED.status_changed_at,
  updated_at = EXCLUDED.updated_at;

INSERT INTO public.contacts (
  user_id, name, title, relationship_origin, relationship_strength,
  notes, active, legacy_referral_id, created_at, updated_at
)
SELECT r.user_id, r.person_name, r.person_title, r.relationship, 3,
  r.notes, true, r.id, r.created_at, r.updated_at
FROM public.referrals r
ON CONFLICT (legacy_referral_id) DO UPDATE SET
  name = EXCLUDED.name,
  title = EXCLUDED.title,
  relationship_origin = EXCLUDED.relationship_origin,
  notes = EXCLUDED.notes,
  updated_at = EXCLUDED.updated_at;

INSERT INTO public.contact_company_links (
  user_id, contact_id, organization_id, relationship_status, created_at, updated_at
)
SELECT r.user_id, ct.id, c.organization_id, 'current', r.created_at, r.updated_at
FROM public.referrals r
JOIN public.contacts ct ON ct.legacy_referral_id = r.id
JOIN public.companies c ON c.id = r.company_id
WHERE c.organization_id IS NOT NULL
ON CONFLICT (contact_id, organization_id) DO NOTHING;

INSERT INTO public.referral_requests (
  user_id, contact_id, organization_id, status, requested_at, submitted_at,
  notes, inferred, created_at, updated_at
)
SELECT r.user_id, ct.id, c.organization_id, r.status,
  CASE WHEN r.status IN ('requested', 'submitted') THEN r.created_at END,
  CASE WHEN r.status = 'submitted' THEN r.updated_at END,
  r.notes, true, r.created_at, r.updated_at
FROM public.referrals r
JOIN public.contacts ct ON ct.legacy_referral_id = r.id
JOIN public.companies c ON c.id = r.company_id
WHERE c.organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.referral_requests rr
    WHERE rr.user_id = r.user_id AND rr.contact_id = ct.id
      AND rr.organization_id = c.organization_id AND rr.job_id IS NULL
  );

INSERT INTO public.applications (
  user_id, legacy_job_id, stage, applied_at, source, inferred, created_at, updated_at
)
SELECT q.user_id, q.job_id, 'applied', q.status_changed_at,
  'legacy_queue_backfill', true, q.created_at, q.updated_at
FROM public.queue_states q
WHERE q.status = 'applied'
ON CONFLICT (user_id, legacy_job_id) DO NOTHING;

INSERT INTO public.application_stage_history (
  user_id, application_id, from_stage, to_stage, reason,
  inferred, transitioned_at, created_at, updated_at
)
SELECT a.user_id, a.id, NULL, 'applied', 'Legacy Applied queue state backfill',
  true, a.applied_at, a.created_at, a.updated_at
FROM public.applications a
WHERE a.inferred
  AND NOT EXISTS (
    SELECT 1 FROM public.application_stage_history h
    WHERE h.application_id = a.id AND h.reason = 'Legacy Applied queue state backfill'
  );
