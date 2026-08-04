import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requireOwner } from "@/lib/auth/owner";

const userOwnedTables = [
  "account_access",
  "candidate_profiles",
  "search_preferences",
  "companies",
  "referrals",
  "watchlists",
  "career_sources",
  "connector_registrations",
  "source_policy_reviews",
  "scan_schedules",
  "scan_runs",
  "scan_source_runs",
  "raw_observations",
  "canonical_jobs",
  "job_source_links",
  "job_description_snapshots",
  "dedupe_fingerprints",
  "eligibility_decisions",
  "ai_analyses",
  "ranking_dimensions",
  "recommendations",
  "queue_states",
  "queue_state_history",
  "user_actions",
  "notifications",
  "digest_deliveries",
  "worker_attempts",
  "dead_letter_records",
  "usage_cost_ledger",
  "outbox_events",
  "retry_records",
  "audit_events",
  "user_company_follows",
  "user_job_eligibility",
  "user_job_ranking_dimensions",
  "user_recommendations",
  "user_job_queue_states",
  "contacts",
  "contact_methods",
  "contact_company_links",
  "contact_interactions",
  "relationship_reminders",
  "referral_requests",
  "resume_versions",
  "application_packet_entries",
  "application_sessions",
  "applications",
  "application_stage_history",
  "application_followups",
  "notification_channels",
  "notification_preferences",
  "push_subscriptions",
  "notification_deliveries",
  "notification_reads",
] as const;

export async function GET() {
  const owner = await requireOwner();
  const data: Record<string, unknown[]> = {};
  for (const table of userOwnedTables) {
    const result = await db.execute<{ record: Record<string, unknown> }>(
      sql`select to_jsonb(export_row) - 'encrypted_capability' - 'configuration_encrypted' as record
          from ${sql.identifier(table)} export_row where user_id = ${owner.id}`,
    );
    data[table] = result.map((row) => row.record);
  }
  const date = new Date().toISOString().slice(0, 10);
  return Response.json(
    {
      exportVersion: 2,
      exportedAt: new Date().toISOString(),
      account: { id: owner.id, email: owner.email },
      data,
    },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="firstseen-export-${date}.json"`,
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
