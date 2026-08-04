import type { DiscoveryQuery } from "./types";

const roleClusters = [
  '("software engineer" OR "software developer" OR "software engineer I" OR "associate software engineer" OR "junior software engineer" OR "early career software engineer" OR "new grad software engineer")',
  '("full stack engineer" OR "full-stack engineer" OR "backend engineer" OR "frontend engineer" OR "software developer I" OR "engineer I")',
  '("AI engineer" OR "applied AI engineer" OR "machine learning engineer" OR "ML engineer" OR "associate AI engineer")',
] as const;

const locations = [
  { locationQuery: "Miami OR Fort Lauderdale OR South Florida", remote: false },
  { locationQuery: "Fairfax OR Washington DC OR Northern Virginia", remote: false },
  { locationQuery: "New York City OR Manhattan OR Brooklyn OR Queens", remote: false },
  { locationQuery: "United States", remote: true },
] as const;

export function buildDiscoveryQueries(_rotation = 0): DiscoveryQuery[] {
  void _rotation;
  // Every role/location cohort runs in every broad cycle. Rotation previously
  // made a specific cluster wait up to sixteen hours on a four-hour schedule.
  return roleClusters.flatMap((roleQuery) =>
    locations.map((location) => ({ roleQuery, ...location })),
  );
}

export function braveQuery(query: DiscoveryQuery): string {
  const location = query.remote ? '"fully remote" OR "remote - US"' : `(${query.locationQuery})`;
  return `${query.roleQuery} ${location} (site:jobs.lever.co OR site:boards.greenhouse.io OR site:job-boards.greenhouse.io OR site:jobs.ashbyhq.com OR site:recruitee.com OR site:pinpointhq.com OR site:careers.*)`;
}
