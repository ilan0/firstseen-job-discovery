-- Brave's standard Search API rights permit transient sensor use, not durable
-- storage of titles, snippets, queries, or result payloads. Preserve only
-- independently verified official provenance and first-observed time.

UPDATE public.companies
SET discovery_evidence = discovery_evidence
  - 'titleHint'
  - 'snippet'
  - 'query'
  - 'result'
  - 'rawResult'
  - 'descriptionHint',
  updated_at = now()
WHERE discovery_evidence ?| ARRAY[
  'titleHint',
  'snippet',
  'query',
  'result',
  'rawResult',
  'descriptionHint'
];

COMMENT ON COLUMN public.companies.discovery_evidence IS
  'Discovery provenance only. Search-result titles, snippets, queries, descriptions, and raw payloads are prohibited.';
