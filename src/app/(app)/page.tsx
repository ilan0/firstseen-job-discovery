import { QueuePage } from "@/components/jobs/queue-page";
import { db } from "@/db/client";
import { searchPreferences } from "@/db/schema";
import { parseFeedSort, parsePostedWindow } from "@/domain/jobs";
import { rolloutFlags } from "@/config/rollout";
import { requireOwner } from "@/lib/auth/owner";
import { listQueue } from "@/lib/jobs/queue";
import { eq } from "drizzle-orm";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const owner = await requireOwner();
  const params = await searchParams;
  const [preferences] = await db
    .select({
      defaultPostedWindow: searchPreferences.defaultPostedWindow,
      defaultFeedSort: searchPreferences.defaultFeedSort,
    })
    .from(searchPreferences)
    .where(eq(searchPreferences.userId, owner.id))
    .limit(1);
  const single = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const postedWithin = parsePostedWindow(
    single(params.postedWithin),
    parsePostedWindow(preferences?.defaultPostedWindow, "7d"),
  );
  const sort = parseFeedSort(
    single(params.sort),
    parseFeedSort(preferences?.defaultFeedSort, "posted_newest"),
  );
  const bandValue = single(params.band);
  const band =
    bandValue === "hot" ||
    bandValue === "strong" ||
    bandValue === "possible" ||
    bandValue === "review"
      ? bandValue
      : "all";
  const query = single(params.q)?.slice(0, 160) ?? "";
  const referralsOnly = single(params.referrals) === "true";
  const feedQuery = { postedWithin, sort, band, query, referralsOnly } as const;
  const freshnessEnabled = rolloutFlags().freshnessFeed;
  const [jobs, olderCandidates] = freshnessEnabled
    ? await Promise.all([
        listQueue(owner.id, "active", feedQuery),
        listQueue(owner.id, "active", {
          ...feedQuery,
          postedWithin: "30d",
        }),
      ])
    : [await listQueue(owner.id, "active"), []];
  const olderExceptional = olderCandidates.filter(
    (job) => job.freshnessSection === "older" && (job.band === "hot" || job.band === "strong"),
  );
  return (
    <QueuePage
      description="Verified official listings no older than your selected window. Freshness is based on the employer's date—not when an aggregator found it."
      feedQuery={freshnessEnabled ? feedQuery : undefined}
      jobs={jobs}
      olderJobs={freshnessEnabled && postedWithin === "7d" ? olderExceptional : []}
      status="active"
      title="Fresh matches"
    />
  );
}
