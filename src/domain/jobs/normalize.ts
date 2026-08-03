import { createHash } from "node:crypto";

const removableQueryParameters = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "source",
  "ref",
  "referrer",
  "gh_src",
  "lever-source",
]);

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTitle(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\b(?:job|position)\b/g, "")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim();
}

export function normalizeOfficialUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const parameter of [...url.searchParams.keys()]) {
    if (removableQueryParameters.has(parameter.toLowerCase())) url.searchParams.delete(parameter);
  }
  url.searchParams.sort();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    .join(",")}}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
