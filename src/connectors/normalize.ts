import { load } from "cheerio";
import { ConnectorError } from "./errors";
import type { ConnectorSource } from "./types";

export function htmlToText(html: string): string {
  const $ = load(`<main>${html}</main>`);
  $("br").replaceWith("\n");
  $("p,li,h1,h2,h3,h4,h5,h6").each((_, element) => {
    $(element).append("\n");
  });
  return $("main")
    .text()
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function requiredTenant(source: ConnectorSource): string {
  const tenant = source.tenantId?.trim();
  if (!tenant || !/^[a-zA-Z0-9_-]+$/.test(tenant)) {
    throw new ConnectorError("INVALID_TENANT", "The source tenant identifier is invalid.", false);
  }
  return tenant;
}

export function conditionalHeaders(source: ConnectorSource): Record<string, string> {
  return {
    ...(source.etag ? { "if-none-match": source.etag } : {}),
    ...(source.lastModified ? { "if-modified-since": source.lastModified } : {}),
  };
}

export function headerMetadata(headers: Headers) {
  return {
    etag: headers.get("etag"),
    lastModified: headers.get("last-modified"),
  };
}

export function idFromUrl(value: string): string | null {
  try {
    const segments = new URL(value).pathname.split("/").filter(Boolean);
    return segments.at(-1) ?? null;
  } catch {
    return null;
  }
}
