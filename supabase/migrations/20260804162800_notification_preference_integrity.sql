-- A global notification preference has organization_id = null. Ordinary
-- PostgreSQL unique indexes treat null values as distinct, which permits
-- duplicate global rows during concurrent device registration.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY channel_id, organization_id
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS duplicate_rank
  FROM public.notification_preferences
)
DELETE FROM public.notification_preferences preference
USING ranked
WHERE preference.id = ranked.id
  AND ranked.duplicate_rank > 1;

DROP INDEX IF EXISTS public.notification_preferences_channel_org_unique;

CREATE UNIQUE INDEX notification_preferences_channel_global_unique
  ON public.notification_preferences (channel_id)
  WHERE organization_id IS NULL;

CREATE UNIQUE INDEX notification_preferences_channel_org_unique
  ON public.notification_preferences (channel_id, organization_id)
  WHERE organization_id IS NOT NULL;

COMMENT ON INDEX public.notification_preferences_channel_global_unique IS
  'Enforces one global (null organization) preference per channel.';

COMMENT ON INDEX public.notification_preferences_channel_org_unique IS
  'Enforces one organization-specific preference per channel.';
