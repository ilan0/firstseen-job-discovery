-- Daily-driver v2 private overlays, relationships, applications, and deliveries.

CREATE TYPE public.application_stage AS ENUM (
  'applied', 'recruiter_screen', 'interview', 'final', 'offer', 'rejected', 'withdrawn'
);
CREATE TYPE public.contact_method_kind AS ENUM ('email', 'phone', 'profile_url', 'other');
CREATE TYPE public.notification_channel_kind AS ENUM ('slack', 'web_push', 'digest');

CREATE TABLE public.user_company_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  interested boolean NOT NULL DEFAULT false,
  scope text NOT NULL DEFAULT 'discovered',
  active boolean NOT NULL DEFAULT true,
  sticky_dismissed boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_company_follows_user_org_unique
  ON public.user_company_follows (user_id, organization_id);
CREATE INDEX user_company_follows_user_scope_idx
  ON public.user_company_follows (user_id, scope);

CREATE TABLE public.user_job_eligibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.global_jobs(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES public.global_job_snapshots(id) ON DELETE CASCADE,
  extraction_id uuid REFERENCES public.job_requirement_extractions(id) ON DELETE SET NULL,
  outcome public.eligibility_outcome NOT NULL,
  rule_version text NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  uncertain_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_job_eligibility_user_snapshot_rule_unique
  ON public.user_job_eligibility (user_id, snapshot_id, rule_version);

CREATE TABLE public.user_job_ranking_dimensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.global_jobs(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES public.global_job_snapshots(id) ON DELETE CASCADE,
  dimension public.ranking_dimension NOT NULL,
  value integer NOT NULL,
  confidence integer NOT NULL,
  explanation text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ranking_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_job_dimensions_value_range CHECK (value BETWEEN 0 AND 100),
  CONSTRAINT user_job_dimensions_confidence_range CHECK (confidence BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX user_job_dimensions_user_snapshot_dimension_version_unique
  ON public.user_job_ranking_dimensions
  (user_id, snapshot_id, dimension, ranking_version);

CREATE TABLE public.user_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.global_jobs(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES public.global_job_snapshots(id) ON DELETE CASCADE,
  eligibility_id uuid NOT NULL REFERENCES public.user_job_eligibility(id) ON DELETE CASCADE,
  band public.recommendation_band NOT NULL,
  urgency integer NOT NULL,
  headline text NOT NULL,
  strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  weaknesses jsonb NOT NULL DEFAULT '[]'::jsonb,
  primary_concern text,
  ranking_version text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  recommended_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_recommendations_urgency_range CHECK (urgency BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX user_recommendations_user_snapshot_version_unique
  ON public.user_recommendations (user_id, snapshot_id, ranking_version);
CREATE INDEX user_recommendations_feed_idx
  ON public.user_recommendations (user_id, active, band);

CREATE TABLE public.user_job_queue_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.global_jobs(id) ON DELETE CASCADE,
  status public.queue_status NOT NULL DEFAULT 'active',
  row_version integer NOT NULL DEFAULT 1,
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_job_queue_states_user_job_unique
  ON public.user_job_queue_states (user_id, job_id);
CREATE INDEX user_job_queue_states_user_status_idx
  ON public.user_job_queue_states (user_id, status);

CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  title text,
  team text,
  location text,
  relationship_origin text,
  relationship_strength integer NOT NULL DEFAULT 3,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_relationship_strength_range CHECK (relationship_strength BETWEEN 1 AND 5)
);
CREATE INDEX contacts_user_name_idx ON public.contacts (user_id, name);

CREATE TABLE public.contact_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  kind public.contact_method_kind NOT NULL,
  value text NOT NULL,
  label text,
  "primary" boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contact_methods_contact_kind_value_unique
  ON public.contact_methods (contact_id, kind, value);

CREATE TABLE public.contact_company_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  relationship_status text NOT NULL DEFAULT 'current',
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contact_company_links_contact_org_unique
  ON public.contact_company_links (contact_id, organization_id);
CREATE INDEX contact_company_links_user_org_idx
  ON public.contact_company_links (user_id, organization_id);

CREATE TABLE public.contact_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  interaction_type text NOT NULL,
  summary text NOT NULL,
  outcome text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_interactions_contact_time_idx
  ON public.contact_interactions (contact_id, occurred_at);

CREATE TABLE public.relationship_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL,
  next_action text NOT NULL,
  completed_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX relationship_reminders_user_due_idx
  ON public.relationship_reminders (user_id, due_at);

CREATE TABLE public.referral_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.global_jobs(id) ON DELETE SET NULL,
  status public.referral_status NOT NULL DEFAULT 'available',
  requested_at timestamptz,
  responded_at timestamptz,
  submitted_at timestamptz,
  expires_at timestamptz,
  completed_at timestamptz,
  notes text,
  inferred boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX referral_requests_user_contact_org_job_unique
  ON public.referral_requests (user_id, contact_id, organization_id, job_id);
CREATE INDEX referral_requests_user_org_status_idx
  ON public.referral_requests (user_id, organization_id, status);

CREATE TABLE public.resume_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL,
  storage_path text NOT NULL,
  source_hash text NOT NULL,
  mime_type text NOT NULL,
  original_filename text NOT NULL,
  size_bytes integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resume_versions_size_limit CHECK (size_bytes BETWEEN 1 AND 5242880)
);
CREATE UNIQUE INDEX resume_versions_user_hash_unique
  ON public.resume_versions (user_id, source_hash);

CREATE TABLE public.application_packet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL,
  label text NOT NULL,
  value text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  sensitive boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX application_packet_entries_user_category_label_unique
  ON public.application_packet_entries (user_id, category, label);
CREATE INDEX application_packet_entries_user_order_idx
  ON public.application_packet_entries (user_id, display_order);

CREATE TABLE public.application_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  global_job_id uuid REFERENCES public.global_jobs(id) ON DELETE CASCADE,
  legacy_job_id uuid REFERENCES public.canonical_jobs(id) ON DELETE CASCADE,
  official_url text NOT NULL,
  device_label text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  returned_at timestamptz,
  disposition text NOT NULL DEFAULT 'opened',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_sessions_has_job CHECK (global_job_id IS NOT NULL OR legacy_job_id IS NOT NULL)
);
CREATE INDEX application_sessions_user_disposition_idx
  ON public.application_sessions (user_id, disposition);

CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  global_job_id uuid REFERENCES public.global_jobs(id) ON DELETE CASCADE,
  legacy_job_id uuid REFERENCES public.canonical_jobs(id) ON DELETE CASCADE,
  application_session_id uuid REFERENCES public.application_sessions(id) ON DELETE SET NULL,
  resume_version_id uuid REFERENCES public.resume_versions(id) ON DELETE SET NULL,
  referral_request_id uuid REFERENCES public.referral_requests(id) ON DELETE SET NULL,
  stage public.application_stage NOT NULL DEFAULT 'applied',
  applied_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  notes text,
  inferred boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT applications_has_job CHECK (global_job_id IS NOT NULL OR legacy_job_id IS NOT NULL)
);
CREATE UNIQUE INDEX applications_user_global_job_unique
  ON public.applications (user_id, global_job_id);
CREATE UNIQUE INDEX applications_user_legacy_job_unique
  ON public.applications (user_id, legacy_job_id);
CREATE INDEX applications_user_stage_applied_idx
  ON public.applications (user_id, stage, applied_at);

CREATE TABLE public.application_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  from_stage public.application_stage,
  to_stage public.application_stage NOT NULL,
  reason text NOT NULL,
  inferred boolean NOT NULL DEFAULT false,
  transitioned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX application_stage_history_app_time_idx
  ON public.application_stage_history (application_id, transitioned_at);

CREATE TABLE public.application_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL,
  next_action text NOT NULL,
  completed_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX application_followups_user_due_idx
  ON public.application_followups (user_id, due_at);

CREATE TABLE public.notification_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.notification_channel_kind NOT NULL,
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  configuration_encrypted text,
  last_success_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notification_channels_user_kind_label_unique
  ON public.notification_channels (user_id, kind, label);

CREATE TABLE public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.notification_channels(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  immediate_hot boolean NOT NULL DEFAULT true,
  immediate_strong boolean NOT NULL DEFAULT true,
  referral_company boolean NOT NULL DEFAULT true,
  digest boolean NOT NULL DEFAULT true,
  detailed_lock_screen boolean NOT NULL DEFAULT false,
  quiet_hours_start integer NOT NULL DEFAULT 22,
  quiet_hours_end integer NOT NULL DEFAULT 7,
  timezone text NOT NULL DEFAULT 'America/New_York',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notification_preferences_channel_org_unique
  ON public.notification_preferences (channel_id, organization_id);

CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.notification_channels(id) ON DELETE CASCADE,
  endpoint_hash text NOT NULL,
  encrypted_capability text NOT NULL,
  user_agent_safe text,
  device_label text,
  expiration_time timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX push_subscriptions_endpoint_hash_unique
  ON public.push_subscriptions (endpoint_hash);
CREATE INDEX push_subscriptions_user_active_idx
  ON public.push_subscriptions (user_id, revoked_at);

CREATE TABLE public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logical_notification_id uuid REFERENCES public.notifications(id) ON DELETE CASCADE,
  global_job_id uuid REFERENCES public.global_jobs(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.notification_channels(id) ON DELETE CASCADE,
  push_subscription_id uuid REFERENCES public.push_subscriptions(id) ON DELETE SET NULL,
  reason text NOT NULL,
  policy_version text NOT NULL,
  idempotency_key text NOT NULL,
  status public.delivery_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  accepted_at timestamptz,
  failed_at timestamptz,
  provider_response_safe jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notification_deliveries_idempotency_unique
  ON public.notification_deliveries (idempotency_key);
CREATE INDEX notification_deliveries_retry_idx
  ON public.notification_deliveries (status, next_attempt_at);

CREATE TABLE public.notification_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logical_notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notification_reads_user_logical_unique
  ON public.notification_reads (user_id, logical_notification_id);

DO $$
DECLARE
  table_name text;
  private_tables constant text[] := ARRAY[
    'user_company_follows', 'user_job_eligibility', 'user_job_ranking_dimensions',
    'user_recommendations', 'user_job_queue_states', 'contacts', 'contact_methods',
    'contact_company_links', 'contact_interactions', 'relationship_reminders',
    'referral_requests', 'resume_versions', 'application_packet_entries',
    'application_sessions', 'applications', 'application_stage_history',
    'application_followups', 'notification_channels', 'notification_preferences',
    'push_subscriptions', 'notification_deliveries', 'notification_reads'
  ];
BEGIN
  FOREACH table_name IN ARRAY private_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY owner_select ON public.%I FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id)',
      table_name
    );
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', table_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      'set_' || table_name || '_updated_at',
      table_name
    );
  END LOOP;
END
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'firstseen-resumes',
  'firstseen-resumes',
  false,
  5242880,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
