insert into public.connector_definitions
  (kind, display_name, capabilities, default_rate_limit, enabled)
values
  ('greenhouse', 'Greenhouse', '{"structured":true,"official":true,"closureDetection":true}', '{"requests":60,"windowSeconds":60}', true),
  ('lever', 'Lever', '{"structured":true,"official":true,"closureDetection":true}', '{"requests":60,"windowSeconds":60}', true),
  ('ashby', 'Ashby', '{"structured":true,"official":true,"closureDetection":true}', '{"requests":60,"windowSeconds":60}', true),
  ('smartrecruiters', 'SmartRecruiters', '{"structured":true,"official":true,"closureDetection":true}', '{"requests":30,"windowSeconds":60}', true),
  ('workday', 'Workday', '{"structured":false,"official":true,"tenantSpecific":true}', '{"requests":15,"windowSeconds":60}', true),
  ('icims', 'iCIMS', '{"structured":false,"official":true,"tenantSpecific":true}', '{"requests":15,"windowSeconds":60}', true),
  ('jobvite', 'Jobvite', '{"structured":false,"official":true,"tenantSpecific":true}', '{"requests":15,"windowSeconds":60}', true),
  ('custom_jsonld', 'Custom JSON-LD', '{"structured":true,"official":true,"policyReview":true}', '{"requests":10,"windowSeconds":60}', true),
  ('custom_html', 'Custom HTML', '{"structured":false,"official":true,"policyReview":true}', '{"requests":10,"windowSeconds":60}', true),
  ('brave', 'Brave Search', '{"sensor":true,"official":false,"transientResults":true}', '{"requests":1,"windowSeconds":1}', true),
  ('adzuna', 'Adzuna', '{"sensor":true,"official":false,"attributionRequired":true}', '{"requests":1,"windowSeconds":1}', true),
  ('unsupported', 'Unsupported source', '{"manual":true}', '{}', true)
on conflict (kind) do update set
  display_name = excluded.display_name,
  capabilities = excluded.capabilities,
  default_rate_limit = excluded.default_rate_limit,
  enabled = excluded.enabled;
