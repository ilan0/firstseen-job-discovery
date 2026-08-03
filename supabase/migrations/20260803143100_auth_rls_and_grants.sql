-- FirstSeen keeps browser sessions on the authenticated role and reserves all writes for
-- server-authorized routes and workers using the server-only Supabase secret.

do $$
declare
  table_name text;
  user_tables constant text[] := array[
    'candidate_profiles', 'search_preferences', 'companies', 'referrals', 'watchlists',
    'career_sources', 'connector_registrations', 'source_policy_reviews', 'scan_schedules',
    'scan_runs', 'scan_source_runs', 'raw_observations', 'canonical_jobs', 'job_source_links',
    'job_description_snapshots', 'dedupe_fingerprints', 'eligibility_decisions', 'ai_analyses',
    'ranking_dimensions', 'recommendations', 'queue_states', 'queue_state_history',
    'user_actions', 'notifications', 'digest_deliveries', 'worker_attempts',
    'dead_letter_records', 'usage_cost_ledger', 'outbox_events', 'retry_records', 'audit_events'
  ];
begin
  foreach table_name in array user_tables loop
    execute format(
      'alter table public.%I add constraint %I foreign key (user_id) references auth.users(id) on delete cascade',
      table_name,
      table_name || '_user_id_fkey'
    );
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy owner_select on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      table_name
    );
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end
$$;

alter table public.connector_definitions enable row level security;
create policy authenticated_read on public.connector_definitions
  for select to authenticated using (true);
revoke all on table public.connector_definitions from anon, authenticated;
grant select on table public.connector_definitions to authenticated;
grant all on table public.connector_definitions to service_role;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  row record;
begin
  for row in
    select table_name
    from information_schema.columns
    where table_schema = 'public' and column_name = 'updated_at'
  loop
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      row.table_name,
      row.table_name
    );
  end loop;
end
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
grant execute on function public.set_updated_at() to service_role;
