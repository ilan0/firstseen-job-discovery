import postgres from "postgres";

const expectedRef = "tlhwxayhjamopnnlroke";
const projectRef = process.env.SUPABASE_PROJECT_REF;
const databaseUrl = process.env.DATABASE_URL;

if (projectRef !== expectedRef || !databaseUrl?.includes(expectedRef)) {
  throw new Error("Refusing schema verification: target is not the dedicated FirstSeen project");
}

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  ssl: "require",
});

try {
  const [result] = await sql<
    Array<{
      organizations: string;
      global_sources: string;
      private_tables_without_rls: string;
      global_raw_browser_read: boolean;
      latest_migration_present: boolean;
    }>
  >`
    select
      (select count(*)::text from public.organizations) as organizations,
      (select count(*)::text from public.global_career_sources) as global_sources,
      (
        select count(*)::text
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = any(array[
            'user_company_follows', 'user_job_eligibility', 'user_job_ranking_dimensions',
            'user_recommendations', 'contacts', 'contact_methods', 'contact_company_links',
            'contact_interactions', 'relationship_reminders', 'referral_requests',
            'resume_versions', 'application_packet_entries', 'application_sessions',
            'applications', 'application_stage_history', 'application_followups',
            'notification_channels', 'notification_preferences', 'push_subscriptions',
            'notification_deliveries', 'notification_reads'
          ])
          and not c.relrowsecurity
      ) as private_tables_without_rls,
      has_table_privilege('authenticated', 'public.global_raw_observations', 'select')
        or has_table_privilege('anon', 'public.global_raw_observations', 'select')
        as global_raw_browser_read,
      exists(
        select 1 from supabase_migrations.schema_migrations
        where version = '20260804162300'
      ) as latest_migration_present
  `;

  console.log(
    JSON.stringify({
      ok:
        result?.private_tables_without_rls === "0" &&
        result.global_raw_browser_read === false &&
        result.latest_migration_present,
      target: "dedicated-firstseen",
      ...result,
    }),
  );
} finally {
  await sql.end({ timeout: 5 });
}
