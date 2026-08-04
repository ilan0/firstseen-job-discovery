-- Machine-readable provider capabilities and rights. This registry is conservative:
-- activation never implies commercial display/storage rights beyond independently
-- verified employer/ATS facts.

INSERT INTO public.provider_capabilities (
  provider, connector_kind, capability_version, anonymous_access, documented_api,
  supports_pagination, supports_conditional_requests, supports_published_time,
  supports_closure, operational_limits, evidence_urls, active
)
VALUES
  ('greenhouse', 'greenhouse', '2026-08-04.1', true, true, false, true, true, true,
    '{"authority":"official_job_board"}', ARRAY['https://developers.greenhouse.io/job-board'], true),
  ('lever', 'lever', '2026-08-04.1', true, true, true, true, true, true,
    '{"authority":"official_postings_api"}', ARRAY['https://github.com/lever/postings-api'], true),
  ('ashby', 'ashby', '2026-08-04.1', true, true, false, true, true, true,
    '{"authority":"official_public_job_board"}', ARRAY['https://developers.ashbyhq.com/docs/public-job-posting-api'], true),
  ('recruitee', 'recruitee', '2026-08-04.1', true, true, false, true, true, true,
    '{"authority":"published_careers_site_offers"}', ARRAY['https://docs.recruitee.com/reference/intro-to-careers-site-api'], true),
  ('pinpoint', 'pinpoint', '2026-08-04.1', true, true, false, true, false, true,
    '{"endpoint":"postings.json"}', ARRAY['https://developers.pinpointhq.com/docs/jobs-json-endpoint'], true),
  ('reviewed-jsonld', 'custom_jsonld', '2026-08-04.1', true, true, false, true, true, true,
    '{"manual_review_required":true}', ARRAY['https://developers.google.com/search/docs/appearance/structured-data/job-posting'], true)
ON CONFLICT (provider, capability_version) DO UPDATE SET
  connector_kind = EXCLUDED.connector_kind,
  anonymous_access = EXCLUDED.anonymous_access,
  documented_api = EXCLUDED.documented_api,
  supports_pagination = EXCLUDED.supports_pagination,
  supports_conditional_requests = EXCLUDED.supports_conditional_requests,
  supports_published_time = EXCLUDED.supports_published_time,
  supports_closure = EXCLUDED.supports_closure,
  operational_limits = EXCLUDED.operational_limits,
  evidence_urls = EXCLUDED.evidence_urls,
  active = EXCLUDED.active,
  updated_at = now();

INSERT INTO public.provider_license_records (
  provider, license_version, status, personal_use, commercial_use,
  may_persist, may_display, may_resolve_redirects, retention_days, terms_url, evidence
)
VALUES
  ('brave', '2026-08-04.1', 'transient_sensor_only', true, false,
    false, false, true, 0,
    'https://api-dashboard.search.brave.com/documentation/resources/terms-of-service',
    '{"durable_fields":["provider","firstObservedAt"],"raw_results_in_events":false}'),
  ('adzuna', '2026-08-04.1', 'quarantined_pending_written_permission', false, false,
    false, false, false, 0,
    'https://developer.adzuna.com/docs/terms_of_service',
    '{"automated_requests":false,"offsite_redirect_resolution":false}')
ON CONFLICT (provider, license_version) DO UPDATE SET
  status = EXCLUDED.status,
  personal_use = EXCLUDED.personal_use,
  commercial_use = EXCLUDED.commercial_use,
  may_persist = EXCLUDED.may_persist,
  may_display = EXCLUDED.may_display,
  may_resolve_redirects = EXCLUDED.may_resolve_redirects,
  retention_days = EXCLUDED.retention_days,
  terms_url = EXCLUDED.terms_url,
  evidence = EXCLUDED.evidence,
  updated_at = now();

INSERT INTO public.global_source_policies (
  career_source_id, provider, policy_version, status, may_request,
  may_use_transiently, may_persist, may_display, may_resolve_redirects,
  expected_organization, closure_method, reviewed_by, activated_at
)
SELECT s.id, s.connector_kind::text, '2026-08-04.1',
  CASE WHEN s.connector_kind = 'custom_jsonld' THEN 'conditional_reviewed_source' ELSE 'approved_official_public_source' END,
  true, true, true, true, false, o.name,
  CASE WHEN s.connector_kind IN ('greenhouse', 'lever', 'ashby', 'recruitee', 'pinpoint')
    THEN 'complete_official_feed' ELSE 'reviewed_page_verification' END,
  'system-baseline', now()
FROM public.global_career_sources s
JOIN public.organizations o ON o.id = s.organization_id
WHERE s.connector_kind IN ('greenhouse', 'lever', 'ashby', 'recruitee', 'pinpoint', 'custom_jsonld')
  AND NOT EXISTS (
    SELECT 1 FROM public.global_source_policies p
    WHERE p.career_source_id = s.id AND p.provider = s.connector_kind::text
      AND p.policy_version = '2026-08-04.1'
  );
