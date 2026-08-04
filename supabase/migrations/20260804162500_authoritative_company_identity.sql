-- Company identity follows a verified global organization when available.
-- Same-named employers remain distinct instead of being merged by display name.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.companies
    WHERE organization_id IS NOT NULL
    GROUP BY user_id, organization_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce authoritative company identity: duplicate user/organization rows exist';
  END IF;
END
$$;

DROP INDEX IF EXISTS public.companies_user_normalized_name_unique;

CREATE UNIQUE INDEX IF NOT EXISTS companies_user_organization_unique
  ON public.companies (user_id, organization_id)
  WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS companies_user_legacy_name_unique
  ON public.companies (user_id, normalized_name)
  WHERE organization_id IS NULL;
