import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { Agent } from "undici";
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

type ResolvedAddress = { address: string; family: number };

export type SafeUrlResolution = {
  url: URL;
  addresses: ResolvedAddress[];
};

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".").map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

export function isPublicIp(address: string): boolean {
  const lowerAddress = address.toLowerCase();
  const mapped = lowerAddress.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPublicIp(mapped);
  const mappedHex = lowerAddress.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1]!, 16);
    const low = Number.parseInt(mappedHex[2]!, 16);
    return isPublicIp(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
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
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a! >= 224
    )
      return false;
    return true;
  }

  const normalized = lowerAddress;
  if (isIP(normalized) !== 6) return false;
  // Public connector traffic has no reason to use transition, local-use, or
  // protocol-assignment space. Restrict IPv6 to global unicast (2000::/3),
  // then exclude the special-purpose ranges that sit inside that block.
  const [firstPart, secondPart] = normalized.split(":", 2);
  const firstHextet = Number.parseInt(firstPart || "0", 16);
  const secondHextet = Number.parseInt(secondPart || "0", 16);
  if (firstHextet < 0x2000 || firstHextet > 0x3fff) return false;
  return !(
    // IETF protocol assignments include Teredo and benchmarking addresses.
    (firstHextet === 0x2001 && secondHextet < 0x200) ||
    normalized.startsWith("2001:db8") ||
    normalized.startsWith("2002:") ||
    normalized.startsWith("3fff:")
  );
}

export async function resolveSafeUrl(
  value: string,
  options: Pick<SafeRequestOptions, "allowedHosts" | "allowHttpForTests"> = {},
): Promise<SafeUrlResolution> {
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

  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
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
  return { url, addresses };
}

export async function assertSafeUrl(
  value: string,
  options: Pick<SafeRequestOptions, "allowedHosts" | "allowHttpForTests"> = {},
): Promise<URL> {
  return (await resolveSafeUrl(value, options)).url;
}

type PinnedFetchResult = {
  response: Response;
  release(): Promise<void>;
};

/**
 * Connect to an address from the same DNS answer that passed the public-IP
 * check. TLS and the Host header still use the original hostname. This closes
 * the validate-then-resolve-again window used by DNS-rebinding attacks.
 */
export async function fetchPinnedResolution(
  resolution: SafeUrlResolution,
  init: RequestInit,
): Promise<PinnedFetchResult> {
  let addressIndex = 0;
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions.all) {
          callback(null, resolution.addresses);
          return;
        }
        const address = resolution.addresses[addressIndex++ % resolution.addresses.length]!;
        callback(null, address.address, address.family);
      },
    },
  });
  try {
    const pinnedFetch = fetch as (
      input: URL,
      init: RequestInit & { dispatcher: Agent },
    ) => Promise<Response>;
    const response = await pinnedFetch(resolution.url, { ...init, dispatcher });
    return {
      response,
      release: async () => {
        await dispatcher.close();
      },
    };
  } catch (error) {
    await dispatcher.close().catch(() => undefined);
    throw error;
  }
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
    const resolution = await resolveSafeUrl(current, options);
    const url = resolution.url;
    const normalizedUrl = url.toString();
    if (visited.has(normalizedUrl)) {
      throw new ConnectorError("REDIRECT_LOOP", "The source returned a redirect loop.", false);
    }
    visited.add(normalizedUrl);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    let response: Response | undefined;
    let release: () => Promise<void> = async () => undefined;
    try {
      const fetched = await fetchPinnedResolution(resolution, {
        method: "GET",
        headers: {
          accept: "application/json, application/ld+json, text/html;q=0.9, */*;q=0.5",
          "user-agent": "FirstSeen/1.0 (+personal job discovery; official sources only)",
          ...options.headers,
        },
        redirect: "manual",
        signal,
      });
      response = fetched.response;
      release = fetched.release;
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new ConnectorError(
        timedOut ? "SOURCE_TIMEOUT" : "NETWORK_FAILED",
        timedOut ? "The source request timed out." : "The source network request failed.",
        true,
      );
    }
    try {
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
    } finally {
      await response.body?.cancel().catch(() => undefined);
      await release();
    }
  }
  throw new ConnectorError("REDIRECT_FAILED", "The source redirect failed.", false);
}
