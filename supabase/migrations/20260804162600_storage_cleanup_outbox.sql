-- Service-only durable cleanup for private Storage objects after account deletion.

CREATE TABLE IF NOT EXISTS public.storage_cleanup_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL,
  object_path text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'waiting',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  cleaned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT storage_cleanup_attempts_nonnegative CHECK (attempt_count >= 0),
  CONSTRAINT storage_cleanup_status_valid
    CHECK (status IN ('waiting', 'pending', 'processing', 'failed', 'cleaned')),
  CONSTRAINT storage_cleanup_bucket_path_unique UNIQUE (bucket, object_path)
);

CREATE INDEX IF NOT EXISTS storage_cleanup_due_idx
  ON public.storage_cleanup_records (status, next_attempt_at);

ALTER TABLE public.storage_cleanup_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.storage_cleanup_records FROM anon, authenticated;
GRANT ALL ON TABLE public.storage_cleanup_records TO service_role;
