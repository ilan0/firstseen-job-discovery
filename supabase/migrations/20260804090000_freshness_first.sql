CREATE TYPE "public"."watchlist_scope" AS ENUM ('personal', 'discovered');
CREATE TYPE "public"."monitoring_tier" AS ENUM ('priority', 'standard', 'warm', 'cold', 'quarantined');

ALTER TABLE "companies"
  ADD COLUMN "interested" boolean DEFAULT false NOT NULL;

ALTER TABLE "watchlists"
  ADD COLUMN "scope" "watchlist_scope" DEFAULT 'personal' NOT NULL,
  ADD COLUMN "monitoring_tier" "monitoring_tier" DEFAULT 'standard' NOT NULL;

ALTER TABLE "search_preferences"
  ADD COLUMN "default_posted_window" text DEFAULT '7d' NOT NULL,
  ADD COLUMN "default_feed_sort" text DEFAULT 'posted_newest' NOT NULL,
  ADD CONSTRAINT "search_preferences_posted_window"
    CHECK ("default_posted_window" IN ('6h', '24h', '3d', '7d', '30d', 'all')),
  ADD CONSTRAINT "search_preferences_feed_sort"
    CHECK ("default_feed_sort" IN ('posted_newest', 'detected_newest', 'urgency'));

UPDATE "companies"
SET "interested" = true, "updated_at" = now()
WHERE "origin" IN ('manual', 'referral');

UPDATE "watchlists" AS w
SET
  "scope" = CASE WHEN c."origin" = 'discovered' THEN 'discovered'::"watchlist_scope" ELSE 'personal'::"watchlist_scope" END,
  "monitoring_tier" = CASE
    WHEN c."interested" OR EXISTS (
      SELECT 1 FROM "referrals" r
      WHERE r."company_id" = c."id" AND r."user_id" = w."user_id"
        AND r."status" IN ('available', 'requested', 'submitted')
    ) THEN 'priority'::"monitoring_tier"
    WHEN c."origin" = 'discovered' THEN 'cold'::"monitoring_tier"
    ELSE 'standard'::"monitoring_tier"
  END,
  "cadence_minutes" = CASE
    WHEN c."interested" OR EXISTS (
      SELECT 1 FROM "referrals" r
      WHERE r."company_id" = c."id" AND r."user_id" = w."user_id"
        AND r."status" IN ('available', 'requested', 'submitted')
    ) THEN 15
    WHEN c."origin" = 'discovered' THEN 240
    ELSE 60
  END,
  "updated_at" = now()
FROM "companies" AS c
WHERE c."id" = w."company_id" AND c."user_id" = w."user_id";

CREATE INDEX "watchlists_user_scope_idx" ON "watchlists" ("user_id", "scope");
CREATE INDEX "canonical_jobs_user_posted_idx" ON "canonical_jobs" ("user_id", "posted_at" DESC);

-- Legacy first snapshots described initial discovery as a material update. Only
-- later snapshots may carry change reasons.
UPDATE "job_description_snapshots" AS current
SET "material_change_reasons" = ARRAY[]::text[], "updated_at" = now()
WHERE NOT EXISTS (
  SELECT 1
  FROM "job_description_snapshots" AS previous
  WHERE previous."job_id" = current."job_id"
    AND previous."captured_at" < current."captured_at"
);
