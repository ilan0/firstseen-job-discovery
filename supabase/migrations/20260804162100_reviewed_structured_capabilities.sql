-- Capability registry rows must be committed after PostgreSQL adds enum values.

insert into public.provider_capabilities (
  provider,
  connector_kind,
  capability_version,
  anonymous_access,
  documented_api,
  supports_pagination,
  supports_conditional_requests,
  supports_published_time,
  supports_closure,
  operational_limits,
  evidence_urls,
  active
)
values
  ('custom_feed', 'custom_feed', '2026-08-04.1', true, false, false, true, true, true,
   '{"formats":["rss","atom"],"generic_dom_scraping":false,"requires_source_policy":true}', ARRAY[]::text[], true),
  ('custom_sitemap', 'custom_sitemap', '2026-08-04.1', true, false, false, true, true, true,
   '{"leaf_verification":"JobPosting JSON-LD","generic_dom_scraping":false,"requires_source_policy":true}', ARRAY['https://developers.google.com/search/docs/appearance/structured-data/job-posting'], true)
on conflict (provider, capability_version) do update set
  connector_kind = excluded.connector_kind,
  anonymous_access = excluded.anonymous_access,
  documented_api = excluded.documented_api,
  supports_pagination = excluded.supports_pagination,
  supports_conditional_requests = excluded.supports_conditional_requests,
  supports_published_time = excluded.supports_published_time,
  supports_closure = excluded.supports_closure,
  operational_limits = excluded.operational_limits,
  evidence_urls = excluded.evidence_urls,
  active = excluded.active,
  updated_at = now();
