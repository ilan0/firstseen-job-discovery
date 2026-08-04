CREATE TABLE public.global_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id uuid NOT NULL REFERENCES public.global_scan_runs(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  aggregate_id uuid NOT NULL REFERENCES public.global_career_sources(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  status public.outbox_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX global_outbox_events_idempotency_unique
  ON public.global_outbox_events (idempotency_key);
CREATE INDEX global_outbox_events_dispatch_idx
  ON public.global_outbox_events (status, available_at, id);

ALTER TABLE public.global_outbox_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.global_outbox_events FROM anon, authenticated;
GRANT ALL ON TABLE public.global_outbox_events TO service_role;

CREATE TRIGGER set_global_outbox_events_updated_at
BEFORE UPDATE ON public.global_outbox_events
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.global_outbox_events IS
  'Service-only durable handoff from a claimed global source schedule to Inngest event dispatch.';
