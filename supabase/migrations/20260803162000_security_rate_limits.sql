create table public.security_rate_limits (
  key_hash text primary key,
  namespace text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  blocked_until timestamptz,
  last_attempt_at timestamptz not null
);

create index security_rate_limits_expiry_idx
  on public.security_rate_limits (window_started_at, blocked_until);

alter table public.security_rate_limits enable row level security;
revoke all on table public.security_rate_limits from public, anon, authenticated;
grant all on table public.security_rate_limits to service_role;
