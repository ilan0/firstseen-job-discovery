import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { ConnectorError } from "./errors";

export type SafeRequestOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  allowedHosts?: string[];
  timeoutMs?: number;
  maximumBytes?: number;
  maximumRedirects?: number;
  allowedContentTypes?: string[];
  allowHttpForTests?: boolean;
};

export type SafeResponse = {
  status: number;
  url: string;
  headers: Headers;
  body: Uint8Array;
  text(): string;
  json<T>(): T;
};

export type SafeGet = typeof safeGet;

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".").map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

export function isPublicIp(address: string): boolean {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPublicIp(mapped);
  const parts = ipv4Parts(address);
  if (parts) {
    const [a, b, c] = parts;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b! >= 64 && b! <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a! >= 224
    )
      return false;
    return true;
  }

  const normalized = address.toLowerCase();
  if (isIP(normalized) !== 6) return false;
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("2001:db8")
  );
}

export async function assertSafeUrl(
  value: string,
  options: Pick<SafeRequestOptions, "allowedHosts" | "allowHttpForTests"> = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConnectorError("INVALID_URL", "The source URL is invalid.", false);
  }
  const allowedProtocol =
    url.protocol === "https:" || (options.allowHttpForTests && url.protocol === "http:");
  if (!allowedProtocol || url.username || url.password || url.port) {
    throw new ConnectorError("UNSAFE_URL", "The source URL is not permitted.", false);
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    options.allowedHosts?.length &&
    !options.allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
  ) {
    throw new ConnectorError("HOST_NOT_ALLOWED", "The source host is not permitted.", false);
  }
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new ConnectorError("PRIVATE_HOST", "Private source hosts are not permitted.", false);
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => {
        throw new ConnectorError("DNS_FAILED", "The source hostname could not be resolved.", true);
      });
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new ConnectorError(
      "PRIVATE_ADDRESS",
      "Private source addresses are not permitted.",
      false,
    );
  }
  return url;
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maximumBytes) {
    throw new ConnectorError("RESPONSE_TOO_LARGE", "The source response is too large.", false);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new ConnectorError("RESPONSE_TOO_LARGE", "The source response is too large.", false);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

const DEFAULT_CONTENT_TYPES = [
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/rss+xml",
  "application/atom+xml",
  "text/html",
  "text/plain",
  "text/xml",
] as const;

function assertAllowedContentType(response: Response, allowedContentTypes: readonly string[]) {
  if ([204, 304].includes(response.status)) return;
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (
    !contentType ||
    !allowedContentTypes.some((allowed) => contentType === allowed.toLowerCase())
  ) {
    throw new ConnectorError(
      "UNSUPPORTED_CONTENT_TYPE",
      "The source returned an unsupported content type.",
      false,
      response.status,
    );
  }
}

export async function safeGet(
  value: string,
  options: SafeRequestOptions = {},
): Promise<SafeResponse> {
  const maximumRedirects = options.maximumRedirects ?? 5;
  const maximumBytes = options.maximumBytes ?? 2_000_000;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const allowedContentTypes = options.allowedContentTypes ?? [...DEFAULT_CONTENT_TYPES];
  let current = value;
  const visited = new Set<string>();

  for (let redirect = 0; redirect <= maximumRedirects; redirect += 1) {
    const url = await assertSafeUrl(current, options);
    const normalizedUrl = url.toString();
    if (visited.has(normalizedUrl)) {
      throw new ConnectorError("REDIRECT_LOOP", "The source returned a redirect loop.", false);
    }
    visited.add(normalizedUrl);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json, application/ld+json, text/html;q=0.9, */*;q=0.5",
          "user-agent": "FirstSeen/1.0 (+personal job discovery; official sources only)",
          ...options.headers,
        },
        redirect: "manual",
        signal,
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new ConnectorError(
        timedOut ? "SOURCE_TIMEOUT" : "NETWORK_FAILED",
        timedOut ? "The source request timed out." : "The source network request failed.",
        true,
      );
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location)
        throw new ConnectorError(
          "INVALID_REDIRECT",
          "The source returned an invalid redirect.",
          false,
        );
      if (redirect === maximumRedirects) {
        throw new ConnectorError(
          "TOO_MANY_REDIRECTS",
          "The source redirected too many times.",
          false,
        );
      }
      current = new URL(location, url).toString();
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      throw new ConnectorError(
        response.status === 429 ? "SOURCE_RATE_LIMITED" : "SOURCE_UNAVAILABLE",
        response.status === 429
          ? "The source rate limit was reached."
          : "The source is temporarily unavailable.",
        true,
        response.status,
      );
    }

    assertAllowedContentType(response, allowedContentTypes);
    const body = await readBoundedBody(response, maximumBytes);
    const decoder = new TextDecoder("utf-8", { fatal: false });
    return {
      status: response.status,
      url: url.toString(),
      headers: response.headers,
      body,
      text: () => decoder.decode(body),
      json: <T>() => {
        try {
          return JSON.parse(decoder.decode(body)) as T;
        } catch {
          throw new ConnectorError("INVALID_JSON", "The source returned invalid JSON.", false);
        }
      },
    };
  }
  throw new ConnectorError("REDIRECT_FAILED", "The source redirect failed.", false);
}
