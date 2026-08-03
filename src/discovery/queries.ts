import type { DiscoveryQuery } from "./types";

const roleRotations = [
  '"software engineer" OR "software developer"',
  '"full stack engineer" OR "backend engineer"',
  '"frontend engineer" OR "AI engineer"',
  '"software engineer I" OR "associate software engineer"',
] as const;

const locations = [
  { locationQuery: "Miami OR Fort Lauderdale OR South Florida", remote: false },
  { locationQuery: "Fairfax OR Washington DC OR Northern Virginia", remote: false },
  { locationQuery: "New York City OR Manhattan OR Brooklyn OR Queens", remote: false },
  { locationQuery: "United States", remote: true },
] as const;

export function buildDiscoveryQueries(rotation: number): DiscoveryQuery[] {
  const roleQuery = roleRotations[Math.abs(rotation) % roleRotations.length]!;
  return locations.map((location) => ({ roleQuery, ...location }));
}

export function braveQuery(query: DiscoveryQuery): string {
  const location = query.remote ? '"fully remote" OR "remote - US"' : `(${query.locationQuery})`;
  return `${query.roleQuery} ${location} (site:jobs.lever.co OR site:boards.greenhouse.io OR site:job-boards.greenhouse.io OR site:jobs.ashbyhq.com OR site:careers.*)`;
}
