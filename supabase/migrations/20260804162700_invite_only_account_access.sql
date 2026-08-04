-- Explicit account allowlist. Auth provider users are not app users unless a
-- service-controlled access row exists.

CREATE TABLE IF NOT EXISTS public.account_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'invited',
  role text NOT NULL DEFAULT 'member',
  invited_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  onboarding_completed_at timestamptz,
  privacy_version text,
  terms_version text,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_access_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT account_access_status_valid CHECK (status IN ('invited', 'active', 'suspended')),
  CONSTRAINT account_access_role_valid CHECK (role IN ('owner', 'admin', 'member'))
);

INSERT INTO public.account_access (
  user_id, email, status, role, invited_at, activated_at, onboarding_completed_at
)
SELECT
  u.id,
  lower(u.email),
  'active',
  CASE
    WHEN row_number() OVER (ORDER BY p.created_at, p.user_id) = 1 THEN 'owner'
    ELSE 'member'
  END,
  coalesce(u.invited_at, u.created_at, now()),
  coalesce(u.confirmed_at, p.created_at, now()),
  p.created_at
FROM public.candidate_profiles p
JOIN auth.users u ON u.id = p.user_id
WHERE u.email IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE public.account_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_access FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.account_access FROM authenticated;
GRANT SELECT ON TABLE public.account_access TO authenticated;
GRANT ALL ON TABLE public.account_access TO service_role;

CREATE POLICY account_access_owner_select ON public.account_access
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
