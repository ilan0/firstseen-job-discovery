import { load } from "cheerio";
import { ConnectorError } from "./errors";
import type { ConnectorSource } from "./types";

export function htmlToText(html: string): string {
  function extract(markup: string) {
    const $ = load(`<main>${markup}</main>`);
    $("script,style,noscript").remove();
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

  const firstPass = extract(html);
  // Greenhouse can return entity-encoded HTML inside JSON. Decode and parse that markup once more
  // rather than persisting visible tags or paying to send them to the model.
  return /&lt;\/?[a-z][^&]*&gt;/i.test(html) && /<\/?[a-z][^>]*>/i.test(firstPass)
    ? extract(firstPass)
    : firstPass;
}

export function requiredTenant(source: ConnectorSource): string {
  const tenant = source.tenantId?.trim();
  if (!tenant || !/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,98}[a-zA-Z0-9])?$/.test(tenant)) {
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
