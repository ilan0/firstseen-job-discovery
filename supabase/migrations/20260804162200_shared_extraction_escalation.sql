alter table public.job_requirement_extractions
  add column if not exists unresolved_fields text[] not null default '{}';

comment on column public.job_requirement_extractions.unresolved_fields is
  'Candidate-neutral Luna/Terra disagreements that force every personalized decision to Review.';
