-- Forward-only connector expansion for documented anonymous careers feeds.
ALTER TYPE public.connector_kind ADD VALUE IF NOT EXISTS 'recruitee';
ALTER TYPE public.connector_kind ADD VALUE IF NOT EXISTS 'pinpoint';
