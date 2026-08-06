DO $$ BEGIN
  CREATE TYPE public.notification_alert_preset AS ENUM (
    'off', 'selective', 'balanced', 'all_viable', 'custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.company_alert_mode AS ENUM ('always', 'mute');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'job_alert';
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'test';

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS alert_preset public.notification_alert_preset NOT NULL DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS immediate_possible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS interested_company boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS hot_strong_max_age_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS possible_max_age_hours integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS role_families text[] NOT NULL DEFAULT ARRAY[
    'general_swe', 'full_stack', 'backend', 'frontend', 'ai_engineering'
  ]::text[],
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS company_override_mode public.company_alert_mode,
  ADD COLUMN IF NOT EXISTS policy_version text;

-- Existing organization-scoped preferences represented an affirmative override.
-- Preserve that behavior while making the new override mode explicit.
UPDATE public.notification_preferences
SET company_override_mode = 'always'
WHERE organization_id IS NOT NULL
  AND company_override_mode IS NULL;

ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_hot_strong_age_valid,
  DROP CONSTRAINT IF EXISTS notification_preferences_possible_age_valid,
  DROP CONSTRAINT IF EXISTS notification_preferences_quiet_start_valid,
  DROP CONSTRAINT IF EXISTS notification_preferences_quiet_end_valid,
  DROP CONSTRAINT IF EXISTS notification_preferences_override_scope_valid;

ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_hot_strong_age_valid
    CHECK (hot_strong_max_age_hours BETWEEN 1 AND 24),
  ADD CONSTRAINT notification_preferences_possible_age_valid
    CHECK (possible_max_age_hours BETWEEN 1 AND 24),
  ADD CONSTRAINT notification_preferences_quiet_start_valid
    CHECK (quiet_hours_start BETWEEN 0 AND 23),
  ADD CONSTRAINT notification_preferences_quiet_end_valid
    CHECK (quiet_hours_end BETWEEN 0 AND 23),
  ADD CONSTRAINT notification_preferences_override_scope_valid
    CHECK (
      (organization_id IS NULL AND company_override_mode IS NULL)
      OR (organization_id IS NOT NULL AND company_override_mode IS NOT NULL)
    );

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS detailed_lock_screen boolean NOT NULL DEFAULT false;

UPDATE public.push_subscriptions subscription
SET detailed_lock_screen = preference.detailed_lock_screen
FROM public.notification_preferences preference
WHERE preference.channel_id = subscription.channel_id
  AND preference.organization_id IS NULL;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS occurrence_id text,
  ADD COLUMN IF NOT EXISTS reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS policy_version text;

INSERT INTO public.notification_channels (user_id, kind, label, enabled)
SELECT profile.user_id, 'web_push'::public.notification_channel_kind, 'Browser push', true
FROM public.candidate_profiles profile
ON CONFLICT (user_id, kind, label)
DO UPDATE SET enabled = true, updated_at = now();

INSERT INTO public.notification_preferences (
  user_id, channel_id, enabled, alert_preset,
  immediate_hot, immediate_strong, immediate_possible,
  referral_company, interested_company,
  hot_strong_max_age_hours, possible_max_age_hours,
  role_families, quiet_hours_enabled, quiet_hours_start, quiet_hours_end,
  timezone, digest, policy_version
)
SELECT
  channel.user_id, channel.id, true, 'balanced',
  true, true, true,
  true, true,
  24, 6,
  ARRAY['general_swe','full_stack','backend','frontend','ai_engineering']::text[],
  true, 23, 7,
  COALESCE(preference.timezone, 'America/New_York'), false, '2026-08-05.1'
FROM public.notification_channels channel
LEFT JOIN public.search_preferences preference ON preference.user_id = channel.user_id
WHERE channel.kind = 'web_push'
ON CONFLICT (channel_id) WHERE organization_id IS NULL
DO UPDATE SET
  enabled = EXCLUDED.enabled,
  alert_preset = EXCLUDED.alert_preset,
  immediate_hot = EXCLUDED.immediate_hot,
  immediate_strong = EXCLUDED.immediate_strong,
  immediate_possible = EXCLUDED.immediate_possible,
  referral_company = EXCLUDED.referral_company,
  interested_company = EXCLUDED.interested_company,
  hot_strong_max_age_hours = EXCLUDED.hot_strong_max_age_hours,
  possible_max_age_hours = EXCLUDED.possible_max_age_hours,
  role_families = EXCLUDED.role_families,
  quiet_hours_enabled = EXCLUDED.quiet_hours_enabled,
  quiet_hours_start = EXCLUDED.quiet_hours_start,
  quiet_hours_end = EXCLUDED.quiet_hours_end,
  timezone = EXCLUDED.timezone,
  digest = false,
  policy_version = EXCLUDED.policy_version,
  updated_at = now()
WHERE notification_preferences.policy_version IS NULL;

UPDATE public.notification_preferences
SET policy_version = '2026-08-05.1'
WHERE policy_version IS NULL;

ALTER TABLE public.notification_preferences
  ALTER COLUMN policy_version SET DEFAULT '2026-08-05.1',
  ALTER COLUMN policy_version SET NOT NULL;

CREATE INDEX IF NOT EXISTS notification_preferences_user_channel_idx
  ON public.notification_preferences (user_id, channel_id);

CREATE INDEX IF NOT EXISTS notifications_user_occurrence_idx
  ON public.notifications (user_id, occurrence_id)
  WHERE occurrence_id IS NOT NULL;

COMMENT ON COLUMN public.notification_preferences.alert_preset IS
  'Preset label; explicit effective fields remain authoritative for deterministic evaluation.';
COMMENT ON COLUMN public.push_subscriptions.detailed_lock_screen IS
  'Per-device privacy preference for Web Push payload content.';
