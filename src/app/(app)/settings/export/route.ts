import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requireOwner } from "@/lib/auth/owner";

const userOwnedTables = [
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
] as const;

export async function GET() {
  const owner = await requireOwner();
  const data: Record<string, unknown[]> = {};
  for (const table of userOwnedTables) {
    const result = await db.execute(
      sql`select * from ${sql.identifier(table)} where user_id = ${owner.id}`,
    );
    data[table] = [...result];
  }
  const date = new Date().toISOString().slice(0, 10);
  return Response.json(
    {
      exportVersion: 1,
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
