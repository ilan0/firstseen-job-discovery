-- Indexed server-side queue filtering for the freshness-first daily feed.
-- This remains additive and does not alter queue state or history.

create index if not exists canonical_jobs_effective_freshness_idx
  on public.canonical_jobs (
    (
      case
        when reopened_at is not null then reopened_at
        when posted_at is not null and posted_at_confidence <> 'low' then posted_at
        else first_seen_at
      end
    ) desc,
    id desc
  )
  where lifecycle_status in ('open', 'reopened');

create index if not exists queue_states_user_status_job_idx
  on public.queue_states (user_id, status, job_id);

create index if not exists recommendations_active_feed_order_idx
  on public.recommendations (user_id, active, band, urgency desc, job_id)
  where active = true;

create index if not exists referrals_actionable_company_idx
  on public.referrals (user_id, company_id)
  where status in ('available', 'requested', 'submitted');
