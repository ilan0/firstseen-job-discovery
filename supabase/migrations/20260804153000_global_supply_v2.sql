-- Daily-driver v2 global supply. This migration is additive and forward-only.

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL,
  canonical_domain text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS organizations_normalized_domain_unique
  ON public.organizations (normalized_name, canonical_domain);

CREATE TABLE IF NOT EXISTS public.organization_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain text NOT NULL,
  authority_confidence integer NOT NULL DEFAULT 0,
  verified_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_domains_authority_range CHECK (authority_confidence BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS organization_domains_domain_unique
  ON public.organization_domains (domain);
CREATE INDEX IF NOT EXISTS organization_domains_org_idx
  ON public.organization_domains (organization_id);

CREATE TABLE IF NOT EXISTS public.provider_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  connector_kind public.connector_kind,
  capability_version text NOT NULL,
  anonymous_access boolean NOT NULL DEFAULT false,
  documented_api boolean NOT NULL DEFAULT false,
  supports_pagination boolean NOT NULL DEFAULT false,
  supports_conditional_requests boolean NOT NULL DEFAULT false,
  supports_published_time boolean NOT NULL DEFAULT false,
  supports_closure boolean NOT NULL DEFAULT false,
  operational_limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_urls text[] NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_capabilities_provider_version_unique
  ON public.provider_capabilities (provider, capability_version);

CREATE TABLE IF NOT EXISTS public.provider_license_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  license_version text NOT NULL,
  status text NOT NULL,
  personal_use boolean NOT NULL DEFAULT false,
  commercial_use boolean NOT NULL DEFAULT false,
  may_persist boolean NOT NULL DEFAULT false,
  may_display boolean NOT NULL DEFAULT false,
  may_resolve_redirects boolean NOT NULL DEFAULT false,
  retention_days integer,
  terms_url text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  activated_at timestamptz,
  terminated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_license_records_provider_version_unique
  ON public.provider_license_records (provider, license_version);

CREATE TABLE IF NOT EXISTS public.coverage_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort text NOT NULL,
  source_family text NOT NULL,
  expected_official_url_hash text NOT NULL,
  expected_official_url_encrypted text,
  independent_observed_at timestamptz NOT NULL,
  firstseen_detected_at timestamptz,
  eligibility_label text NOT NULL,
  matched boolean NOT NULL DEFAULT false,
  detection_latency_minutes numeric(12,3),
  benchmark_version text NOT NULL,
  label_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS coverage_benchmarks_url_version_unique
  ON public.coverage_benchmarks (expected_official_url_hash, benchmark_version);
CREATE INDEX IF NOT EXISTS coverage_benchmarks_cohort_family_idx
  ON public.coverage_benchmarks (cohort, source_family);

CREATE TABLE IF NOT EXISTS public.global_career_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connector_kind public.connector_kind NOT NULL,
  tenant_id text,
  base_url text NOT NULL,
  normalized_url text NOT NULL,
  public_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  parsing_confidence integer NOT NULL DEFAULT 0,
  etag text,
  last_modified text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT global_career_sources_confidence_range CHECK (parsing_confidence BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS global_career_sources_url_unique
  ON public.global_career_sources (normalized_url);
CREATE UNIQUE INDEX IF NOT EXISTS global_career_sources_provider_tenant_unique
  ON public.global_career_sources (connector_kind, tenant_id);

CREATE TABLE IF NOT EXISTS public.global_source_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  career_source_id uuid REFERENCES public.global_career_sources(id) ON DELETE CASCADE,
  provider text NOT NULL,
  policy_version text NOT NULL,
  status text NOT NULL,
  may_request boolean NOT NULL DEFAULT false,
  may_use_transiently boolean NOT NULL DEFAULT false,
  may_persist boolean NOT NULL DEFAULT false,
  may_display boolean NOT NULL DEFAULT false,
  may_resolve_redirects boolean NOT NULL DEFAULT false,
  terms_url text,
  robots_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  allowed_paths text[] NOT NULL DEFAULT ARRAY[]::text[],
  expected_organization text,
  closure_method text,
  retention_days integer,
  reviewed_by text,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS global_source_policies_provider_version_unique
  ON public.global_source_policies (provider, policy_version, career_source_id);

CREATE TABLE IF NOT EXISTS public.global_scan_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  career_source_id uuid NOT NULL REFERENCES public.global_career_sources(id) ON DELETE CASCADE,
  monitoring_tier public.monitoring_tier NOT NULL DEFAULT 'cold',
  cadence_minutes integer NOT NULL DEFAULT 240,
  active boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  leased_until timestamptz,
  lease_token uuid,
  demand_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT global_scan_schedules_cadence_minimum CHECK (cadence_minutes >= 15)
);
CREATE UNIQUE INDEX IF NOT EXISTS global_scan_schedules_source_unique
  ON public.global_scan_schedules (career_source_id);
CREATE INDEX IF NOT EXISTS global_scan_schedules_due_idx
  ON public.global_scan_schedules (active, next_run_at);

CREATE TABLE IF NOT EXISTS public.global_scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  career_source_id uuid NOT NULL REFERENCES public.global_career_sources(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES public.global_scan_schedules(id) ON DELETE SET NULL,
  status public.run_status NOT NULL DEFAULT 'queued',
  idempotency_key text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  complete boolean NOT NULL DEFAULT false,
  observation_count integer NOT NULL DEFAULT 0,
  error_code text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS global_scan_runs_idempotency_unique
  ON public.global_scan_runs (idempotency_key);
CREATE INDEX IF NOT EXISTS global_scan_runs_source_time_idx
  ON public.global_scan_runs (career_source_id, scheduled_for);

CREATE TABLE IF NOT EXISTS public.global_raw_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id uuid REFERENCES public.global_scan_runs(id) ON DELETE SET NULL,
  career_source_id uuid NOT NULL REFERENCES public.global_career_sources(id) ON DELETE CASCADE,
  external_job_id text,
  official_url text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  status public.observation_status NOT NULL,
  content_hash text NOT NULL,
  normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sanitized_body text,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS global_observations_source_hash_time_unique
  ON public.global_raw_observations (career_source_id, content_hash, observed_at);
CREATE INDEX IF NOT EXISTS global_observations_source_time_idx
  ON public.global_raw_observations (career_source_id, observed_at);

CREATE TABLE IF NOT EXISTS public.global_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  authoritative_source_id uuid NOT NULL REFERENCES public.global_career_sources(id) ON DELETE RESTRICT,
  external_job_id text,
  requisition_id text,
  title text NOT NULL,
  normalized_title text NOT NULL,
  official_url text NOT NULL,
  normalized_official_url text NOT NULL,
  apply_url text NOT NULL,
  lifecycle_status public.job_lifecycle_status NOT NULL DEFAULT 'open',
  posted_at timestamptz,
  posted_at_confidence public.confidence_level NOT NULL DEFAULT 'low',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  possibly_closed_at timestamptz,
  closed_at timestamptz,
  reopened_at timestamptz,
  current_snapshot_id uuid,
  current_material_hash text,
  consecutive_successful_misses integer NOT NULL DEFAULT 0,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT global_jobs_misses_nonnegative CHECK (consecutive_successful_misses >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS global_jobs_official_url_unique
  ON public.global_jobs (normalized_official_url);
CREATE INDEX IF NOT EXISTS global_jobs_org_external_idx
  ON public.global_jobs (organization_id, external_job_id);
CREATE INDEX IF NOT EXISTS global_jobs_lifecycle_posted_idx
  ON public.global_jobs (lifecycle_status, posted_at DESC);

CREATE TABLE IF NOT EXISTS public.global_job_source_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.global_jobs(id) ON DELETE CASCADE,
  career_source_id uuid NOT NULL REFERENCES public.global_career_sources(id) ON DELETE CASCADE,
  external_job_id text,
  source_url text NOT NULL,
  authoritative boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS global_job_source_links_job_source_unique
  ON public.global_job_source_links (job_id, career_source_id);

CREATE TABLE IF NOT EXISTS public.global_job_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.global_jobs(id) ON DELETE CASCADE,
  observation_id uuid REFERENCES public.global_raw_observations(id) ON DELETE SET NULL,
  material_hash text NOT NULL,
  description_text text NOT NULL,
  normalized_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  material_change_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS global_job_snapshots_job_hash_unique
  ON public.global_job_snapshots (job_id, material_hash);
CREATE INDEX IF NOT EXISTS global_job_snapshots_job_time_idx
  ON public.global_job_snapshots (job_id, captured_at);

ALTER TABLE public.global_jobs
  ADD CONSTRAINT global_jobs_current_snapshot_id_fkey
  FOREIGN KEY (current_snapshot_id) REFERENCES public.global_job_snapshots(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.global_job_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.global_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  fingerprint text NOT NULL,
  confidence integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT global_job_fingerprints_confidence_range CHECK (confidence BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS global_job_fingerprints_kind_hash_unique
  ON public.global_job_fingerprints (kind, fingerprint);

CREATE TABLE IF NOT EXISTS public.global_job_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.global_jobs(id) ON DELETE CASCADE,
  from_status public.job_lifecycle_status,
  to_status public.job_lifecycle_status NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS global_lifecycle_events_job_time_idx
  ON public.global_job_lifecycle_events (job_id, occurred_at);

CREATE TABLE IF NOT EXISTS public.job_requirement_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES public.global_job_snapshots(id) ON DELETE CASCADE,
  status public.analysis_status NOT NULL DEFAULT 'pending',
  model text NOT NULL,
  escalation_model text,
  schema_version text NOT NULL,
  prompt_hash text NOT NULL,
  extraction_version text NOT NULL,
  structured_output jsonb,
  confidence integer,
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(12,6),
  actual_cost_usd numeric(12,6),
  latency_ms integer,
  completed_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_requirement_extractions_confidence_range
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS job_requirement_extractions_cache_unique
  ON public.job_requirement_extractions
  (snapshot_id, model, schema_version, prompt_hash, extraction_version);

DO $$
DECLARE
  table_name text;
  global_tables constant text[] := ARRAY[
    'organizations', 'organization_domains', 'provider_capabilities',
    'provider_license_records', 'coverage_benchmarks', 'global_career_sources',
    'global_source_policies', 'global_scan_schedules', 'global_scan_runs',
    'global_raw_observations', 'global_jobs', 'global_job_source_links',
    'global_job_snapshots', 'global_job_fingerprints', 'global_job_lifecycle_events',
    'job_requirement_extractions'
  ];
BEGIN
  FOREACH table_name IN ARRAY global_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
  END LOOP;
END
$$;

DO $$
DECLARE
  table_name text;
  trigger_name text;
  global_tables constant text[] := ARRAY[
    'organizations', 'organization_domains', 'provider_capabilities',
    'provider_license_records', 'coverage_benchmarks', 'global_career_sources',
    'global_source_policies', 'global_scan_schedules', 'global_scan_runs',
    'global_raw_observations', 'global_jobs', 'global_job_source_links',
    'global_job_snapshots', 'global_job_fingerprints', 'job_requirement_extractions'
  ];
BEGIN
  FOREACH table_name IN ARRAY global_tables LOOP
    trigger_name := 'set_' || table_name || '_updated_at';
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      trigger_name,
      table_name
    );
  END LOOP;
END
$$;
