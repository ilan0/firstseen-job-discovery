import type { Evidence } from "./types";

export function evidenceFromMatch(
  field: string,
  text: string,
  match: RegExpExecArray,
  source: Evidence["source"] = "description",
): Evidence {
  const start = match.index;
  const end = start + match[0].length;
  return { field, quote: text.slice(start, end), start, end, source };
}

export function metadataEvidence(field: string, quote: string): Evidence {
  return { field, quote, start: 0, end: quote.length, source: "metadata" };
}
