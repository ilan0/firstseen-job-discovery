alter table public.notifications
  add column if not exists payload jsonb not null default '{}'::jsonb;
