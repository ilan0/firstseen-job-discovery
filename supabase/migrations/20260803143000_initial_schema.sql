CREATE TYPE "public"."action_kind" AS ENUM('viewed', 'saved', 'applied', 'dismissed', 'restored', 'opened_official_application');--> statement-breakpoint
CREATE TYPE "public"."analysis_status" AS ENUM('pending', 'succeeded', 'refused', 'invalid', 'failed', 'budget_blocked');--> statement-breakpoint
CREATE TYPE "public"."company_origin" AS ENUM('manual', 'referral', 'discovered');--> statement-breakpoint
CREATE TYPE "public"."confidence_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."connector_kind" AS ENUM('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday', 'icims', 'jobvite', 'custom_jsonld', 'custom_html', 'brave', 'adzuna', 'unsupported');--> statement-breakpoint
CREATE TYPE "public"."cost_provider" AS ENUM('openai', 'brave', 'adzuna', 'inngest', 'slack');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'deferred', 'sending', 'delivered', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."eligibility_outcome" AS ENUM('eligible', 'ineligible', 'review');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'contract', 'internship', 'temporary', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."job_lifecycle_status" AS ENUM('pending_verification', 'open', 'possibly_closed', 'closed', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('exceptional_match', 'morning_digest', 'operational_alert');--> statement-breakpoint
CREATE TYPE "public"."observation_status" AS ENUM('discovered', 'verified', 'unchanged', 'changed', 'not_found', 'invalid', 'failed');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'dispatching', 'dispatched', 'failed');--> statement-breakpoint
CREATE TYPE "public"."policy_status" AS ENUM('approved', 'conditional', 'blocked', 'pending_review');--> statement-breakpoint
CREATE TYPE "public"."queue_status" AS ENUM('active', 'saved', 'applied', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."ranking_dimension" AS ENUM('skills_fit', 'required_experience_alignment', 'role_family_alignment', 'freshness', 'referral_advantage', 'location_eligibility', 'competition_proxy', 'extraction_confidence', 'source_confidence', 'urgency');--> statement-breakpoint
CREATE TYPE "public"."recommendation_band" AS ENUM('hot', 'strong', 'possible', 'review', 'not_recommended');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('available', 'requested', 'submitted', 'declined', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'partially_failed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."schedule_kind" AS ENUM('watchlist', 'broad_discovery', 'closure', 'cleanup');--> statement-breakpoint
CREATE TABLE "candidate_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"headline" text NOT NULL,
	"home_city" text NOT NULL,
	"home_region" text NOT NULL,
	"months_full_time_experience" integer NOT NULL,
	"needs_us_sponsorship" boolean DEFAULT false NOT NULL,
	"citizenships" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"summary" text NOT NULL,
	"education" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"work_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resume_source_hash" text,
	"profile_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_profiles_months_nonnegative" CHECK ("candidate_profiles"."months_full_time_experience" >= 0)
);
--> statement-breakpoint
CREATE TABLE "search_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"full_time_only" boolean DEFAULT true NOT NULL,
	"ideal_required_years_max" integer DEFAULT 1 NOT NULL,
	"eligible_required_years_max" integer DEFAULT 2 NOT NULL,
	"reject_clearance" boolean DEFAULT true NOT NULL,
	"reject_public_trust" boolean DEFAULT true NOT NULL,
	"accepted_areas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allow_fully_remote" boolean DEFAULT true NOT NULL,
	"role_priorities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"salary_minimum_usd" integer,
	"industries_allowed" text[],
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"digest_enabled" boolean DEFAULT true NOT NULL,
	"exceptional_alerts_enabled" boolean DEFAULT true NOT NULL,
	"digest_hour_local" integer DEFAULT 8 NOT NULL,
	"quiet_hours_start_local" integer DEFAULT 22 NOT NULL,
	"quiet_hours_end_local" integer DEFAULT 7 NOT NULL,
	"broad_discovery_cadence_minutes" integer DEFAULT 240 NOT NULL,
	"preferences_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_preferences_experience_bounds" CHECK ("search_preferences"."ideal_required_years_max" <= "search_preferences"."eligible_required_years_max"),
	CONSTRAINT "search_preferences_digest_hour" CHECK ("search_preferences"."digest_hour_local" between 0 and 23)
);
--> statement-breakpoint
CREATE TABLE "canonical_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"authoritative_source_id" uuid NOT NULL,
	"external_job_id" text,
	"requisition_id" text,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"employment_type" "employment_type" DEFAULT 'unknown' NOT NULL,
	"official_url" text NOT NULL,
	"normalized_official_url" text NOT NULL,
	"lifecycle_status" "job_lifecycle_status" DEFAULT 'pending_verification' NOT NULL,
	"posted_at" timestamp with time zone,
	"posted_at_confidence" "confidence_level" DEFAULT 'low' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"possibly_closed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reopened_at" timestamp with time zone,
	"consecutive_successful_misses" integer DEFAULT 0 NOT NULL,
	"current_material_hash" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canonical_jobs_misses_nonnegative" CHECK ("canonical_jobs"."consecutive_successful_misses" >= 0)
);
--> statement-breakpoint
CREATE TABLE "dedupe_fingerprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"confidence" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dedupe_fingerprints_confidence_range" CHECK ("dedupe_fingerprints"."confidence" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "job_description_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"observation_id" uuid,
	"material_hash" text NOT NULL,
	"description_text" text NOT NULL,
	"normalized_facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"material_change_reasons" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_source_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"career_source_id" uuid NOT NULL,
	"external_job_id" text,
	"source_url" text NOT NULL,
	"authoritative" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scan_source_run_id" uuid,
	"career_source_id" uuid NOT NULL,
	"external_job_id" text,
	"official_url" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "observation_status" NOT NULL,
	"http_status" integer,
	"content_type" text,
	"content_hash" text NOT NULL,
	"response_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"normalized_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sanitized_body" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"schedule_id" uuid,
	"kind" "schedule_kind" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"trigger" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"source_count" integer DEFAULT 0 NOT NULL,
	"discovered_count" integer DEFAULT 0 NOT NULL,
	"changed_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "schedule_kind" NOT NULL,
	"career_source_id" uuid,
	"cadence_minutes" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_schedules_cadence_minimum" CHECK ("scan_schedules"."cadence_minutes" >= 10)
);
--> statement-breakpoint
CREATE TABLE "scan_source_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scan_run_id" uuid NOT NULL,
	"career_source_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"response_status" integer,
	"observation_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message_safe" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"status" "analysis_status" DEFAULT 'pending' NOT NULL,
	"model" text NOT NULL,
	"schema_version" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"structured_output" jsonb,
	"refusal_reason_safe" text,
	"error_code" text,
	"input_tokens" integer,
	"cached_input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eligibility_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"outcome" "eligibility_outcome" NOT NULL,
	"rule_version" text NOT NULL,
	"normalized_facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uncertain_fields" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_state_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"from_status" "queue_status",
	"to_status" "queue_status" NOT NULL,
	"action_id" uuid,
	"reason" text NOT NULL,
	"transitioned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"status" "queue_status" DEFAULT 'active' NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ranking_dimensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"dimension" "ranking_dimension" NOT NULL,
	"value" integer NOT NULL,
	"confidence" integer NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"explanation" text NOT NULL,
	"ranking_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ranking_dimensions_value_range" CHECK ("ranking_dimensions"."value" between 0 and 100),
	CONSTRAINT "ranking_dimensions_confidence_range" CHECK ("ranking_dimensions"."confidence" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"eligibility_decision_id" uuid NOT NULL,
	"band" "recommendation_band" NOT NULL,
	"urgency" integer NOT NULL,
	"headline" text NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weaknesses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"routing_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ranking_version" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"recommended_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendations_urgency_range" CHECK ("recommendations"."urgency" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "user_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" "action_kind" NOT NULL,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"metadata_safe" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dead_letter_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workflow_name" text NOT NULL,
	"event_id" text NOT NULL,
	"event_name" text NOT NULL,
	"event_payload" jsonb NOT NULL,
	"error_code" text NOT NULL,
	"error_message_safe" text NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replayed_at" timestamp with time zone,
	"replay_event_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digest_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" text NOT NULL,
	"timezone" text NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"notification_id" uuid,
	"job_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid,
	"snapshot_id" uuid,
	"kind" "notification_kind" NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"deferred_until" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"provider_response_safe" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_name" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"leased_until" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retry_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scan_run_id" uuid,
	"operation_type" text NOT NULL,
	"operation_key" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error_code" text NOT NULL,
	"exhausted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_cost_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "cost_provider" NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"units" numeric(18, 6) DEFAULT '0' NOT NULL,
	"unit_name" text NOT NULL,
	"estimated_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"actual_cost_usd" numeric(12, 6),
	"reservation_status" text DEFAULT 'reserved' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_cost_ledger_estimated_nonnegative" CHECK ("usage_cost_ledger"."estimated_cost_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "worker_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workflow_name" text NOT NULL,
	"event_id" text NOT NULL,
	"step_name" text,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"attempt_number" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"error_message_safe" text,
	"trace_id" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "career_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"connector_kind" "connector_kind" NOT NULL,
	"base_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"public_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"parsing_confidence" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "career_sources_confidence_range" CHECK ("career_sources"."parsing_confidence" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"domain" text,
	"origin" "company_origin" NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"notes" text,
	"provisional" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"discovery_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_priority_range" CHECK ("companies"."priority" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "connector_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "connector_kind" NOT NULL,
	"display_name" text NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_rate_limit" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_definitions_kind_unique" UNIQUE("kind")
);
--> statement-breakpoint
CREATE TABLE "connector_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"career_source_id" uuid NOT NULL,
	"external_tenant_id" text,
	"cursor_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"etag" text,
	"last_modified" text,
	"connector_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"person_name" text NOT NULL,
	"person_title" text,
	"relationship" text,
	"status" "referral_status" DEFAULT 'available' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_policy_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"career_source_id" uuid,
	"hostname" text NOT NULL,
	"status" "policy_status" DEFAULT 'pending_review' NOT NULL,
	"robots_checked_at" timestamp with time zone,
	"terms_url" text,
	"rationale" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"cadence_minutes" integer DEFAULT 60 NOT NULL,
	"next_scan_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlists_cadence_minimum" CHECK ("watchlists"."cadence_minutes" >= 15)
);
--> statement-breakpoint
ALTER TABLE "canonical_jobs" ADD CONSTRAINT "canonical_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_jobs" ADD CONSTRAINT "canonical_jobs_authoritative_source_id_career_sources_id_fk" FOREIGN KEY ("authoritative_source_id") REFERENCES "public"."career_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dedupe_fingerprints" ADD CONSTRAINT "dedupe_fingerprints_job_id_canonical_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."canonical_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_description_snapshots" ADD CONSTRAINT "job_description_snapshots_job_id_canonical_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."canonical_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_description_snapshots" ADD CONSTRAINT "job_description_snapshots_observation_id_raw_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."raw_observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_source_links" ADD CONSTRAINT "job_source_links_job_id_canonical_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."canonical_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_source_links" ADD CONSTRAINT "job_source_links_career_source_id_career_sources_id_fk" FOREIGN KEY ("career_source_id") REFERENCES "public"."career_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_observations" ADD CONSTRAINT "raw_observations_scan_source_run_id_scan_source_runs_id_fk" FOREIGN KEY ("scan_source_run_id") REFERENCES "public"."scan_source_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_observations" ADD CONSTRAINT "raw_observations_career_source_id_career_sources_id_fk" FOREIGN KEY ("career_source_id") REFERENCES "public"."career_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_schedule_id_scan_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."scan_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_schedules" ADD CONSTRAINT "scan_schedules_career_source_id_career_sources_id_fk" FOREIGN KEY ("career_source_id") REFERENCES "public"."career_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_source_runs" ADD CONSTRAINT "scan_source_runs_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_source_runs" ADD CONSTRAINT "scan_source_runs_career_source_id_career_sources_id_fk" FOREIGN KEY ("career_source_id") REFERENCES "public"."career_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_job_id_canonical_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."canonical_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_snapshot_id_job_description_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."job_description_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_decisions" ADD CONSTRAINT "eligibility_decisions_job_id_canonical_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."canonical_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_decisions" ADD CONSTRAINT "eligibility_decisions_snapshot_id_job_description_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."job_description_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_state_history" ADD CONSTRAINT "queue_state_history_job_id_canonical_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."canonical_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_states" ADD CONSTRAINT "queue_states_job_id_canonical_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."canonical_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_dimensions" ADD CONSTRAINT "ranking_dimensions_job_id_canonical_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."canonical_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_dimensions" ADD CONSTRAINT "ranking_dimensions_snapshot_id_job_description_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."job_description_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_job_id_canonical_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."canonical_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_snapshot_id_job_description_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."job_description_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_eligibility_decision_id_eligibility_decisions_id_fk" FOREIGN KEY ("eligibility_decision_id") REFERENCES "public"."eligibility_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_actions" ADD CONSTRAINT "user_actions_job_id_canonical_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."canonical_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_deliveries" ADD CONSTRAINT "digest_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_job_id_canonical_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."canonical_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_snapshot_id_job_description_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."job_description_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retry_records" ADD CONSTRAINT "retry_records_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_sources" ADD CONSTRAINT "career_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_registrations" ADD CONSTRAINT "connector_registrations_career_source_id_career_sources_id_fk" FOREIGN KEY ("career_source_id") REFERENCES "public"."career_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_policy_reviews" ADD CONSTRAINT "source_policy_reviews_career_source_id_career_sources_id_fk" FOREIGN KEY ("career_source_id") REFERENCES "public"."career_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_profiles_user_id_unique" ON "candidate_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "search_preferences_user_id_unique" ON "search_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_jobs_user_url_unique" ON "canonical_jobs" USING btree ("user_id","normalized_official_url");--> statement-breakpoint
CREATE INDEX "canonical_jobs_user_lifecycle_idx" ON "canonical_jobs" USING btree ("user_id","lifecycle_status");--> statement-breakpoint
CREATE INDEX "canonical_jobs_company_external_idx" ON "canonical_jobs" USING btree ("company_id","external_job_id");--> statement-breakpoint
CREATE INDEX "canonical_jobs_last_seen_idx" ON "canonical_jobs" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dedupe_fingerprints_user_kind_hash_unique" ON "dedupe_fingerprints" USING btree ("user_id","kind","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "job_snapshots_job_hash_unique" ON "job_description_snapshots" USING btree ("job_id","material_hash");--> statement-breakpoint
CREATE INDEX "job_snapshots_job_captured_idx" ON "job_description_snapshots" USING btree ("job_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_source_links_job_source_unique" ON "job_source_links" USING btree ("job_id","career_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_observations_source_hash_time_unique" ON "raw_observations" USING btree ("career_source_id","content_hash","observed_at");--> statement-breakpoint
CREATE INDEX "raw_observations_source_observed_idx" ON "raw_observations" USING btree ("career_source_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_runs_idempotency_unique" ON "scan_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "scan_runs_user_scheduled_idx" ON "scan_runs" USING btree ("user_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "scan_schedules_due_idx" ON "scan_schedules" USING btree ("active","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_source_runs_scan_source_unique" ON "scan_source_runs" USING btree ("scan_run_id","career_source_id");--> statement-breakpoint
CREATE INDEX "scan_source_runs_source_created_idx" ON "scan_source_runs" USING btree ("career_source_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_analyses_snapshot_schema_prompt_unique" ON "ai_analyses" USING btree ("snapshot_id","schema_version","prompt_hash");--> statement-breakpoint
CREATE INDEX "ai_analyses_job_created_idx" ON "ai_analyses" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eligibility_decisions_snapshot_rule_unique" ON "eligibility_decisions" USING btree ("snapshot_id","rule_version");--> statement-breakpoint
CREATE INDEX "eligibility_decisions_job_evaluated_idx" ON "eligibility_decisions" USING btree ("job_id","evaluated_at");--> statement-breakpoint
CREATE INDEX "queue_state_history_job_time_idx" ON "queue_state_history" USING btree ("job_id","transitioned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "queue_states_user_job_unique" ON "queue_states" USING btree ("user_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ranking_dimensions_snapshot_dimension_version_unique" ON "ranking_dimensions" USING btree ("snapshot_id","dimension","ranking_version");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendations_snapshot_ranking_version_unique" ON "recommendations" USING btree ("snapshot_id","ranking_version");--> statement-breakpoint
CREATE INDEX "recommendations_user_band_time_idx" ON "recommendations" USING btree ("user_id","band","recommended_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_actions_idempotency_unique" ON "user_actions" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "user_actions_job_time_idx" ON "user_actions" USING btree ("job_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_user_time_idx" ON "audit_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dead_letter_records_event_unique" ON "dead_letter_records" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "dead_letter_records_unresolved_idx" ON "dead_letter_records" USING btree ("resolved_at","failed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "digest_deliveries_user_local_date_unique" ON "digest_deliveries" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_idempotency_unique" ON "notifications" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "notifications_status_deferred_idx" ON "notifications" USING btree ("status","deferred_until");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_events_idempotency_unique" ON "outbox_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_events_dispatch_idx" ON "outbox_events" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "retry_records_operation_unique" ON "retry_records" USING btree ("user_id","operation_type","operation_key");--> statement-breakpoint
CREATE INDEX "retry_records_due_idx" ON "retry_records" USING btree ("exhausted_at","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_cost_ledger_idempotency_unique" ON "usage_cost_ledger" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "usage_cost_ledger_provider_time_idx" ON "usage_cost_ledger" USING btree ("provider","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "worker_attempts_event_step_attempt_unique" ON "worker_attempts" USING btree ("event_id","step_name","attempt_number");--> statement-breakpoint
CREATE INDEX "worker_attempts_status_created_idx" ON "worker_attempts" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "career_sources_user_url_unique" ON "career_sources" USING btree ("user_id","normalized_url");--> statement-breakpoint
CREATE INDEX "career_sources_company_idx" ON "career_sources" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_user_normalized_name_unique" ON "companies" USING btree ("user_id","normalized_name");--> statement-breakpoint
CREATE INDEX "companies_user_priority_idx" ON "companies" USING btree ("user_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_registrations_source_unique" ON "connector_registrations" USING btree ("career_source_id");--> statement-breakpoint
CREATE INDEX "referrals_user_company_idx" ON "referrals" USING btree ("user_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_policy_reviews_user_hostname_unique" ON "source_policy_reviews" USING btree ("user_id","hostname");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlists_user_company_unique" ON "watchlists" USING btree ("user_id","company_id");--> statement-breakpoint
CREATE INDEX "watchlists_due_idx" ON "watchlists" USING btree ("active","next_scan_at");