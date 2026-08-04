import { ConnectorError } from "@/connectors/errors";
import { assertSafeUrl, type SafeRequestOptions } from "@/connectors/http";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const FINAL_CONTENT_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "text/html",
  "text/plain",
]);

export type RedirectResolution = {
  url: string;
  status: number;
  contentType: string | null;
  redirectCount: number;
};

export type RedirectResolverOptions = Pick<SafeRequestOptions, "signal" | "allowHttpForTests"> & {
  fetcher?: typeof fetch;
  maximumRedirects?: number;
  timeoutMs?: number;
  maximumRedirectBodyBytes?: number;
};

export async function resolveSafeRedirect(
  value: string,
  options: RedirectResolverOptions = {},
): Promise<RedirectResolution> {
  const fetcher = options.fetcher ?? fetch;
  const maximumRedirects = options.maximumRedirects ?? 5;
  const maximumRedirectBodyBytes = options.maximumRedirectBodyBytes ?? 32_768;
  const visited = new Set<string>();
  let current = value;

  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    const url = await assertSafeUrl(current, options);
    const normalized = url.toString();
    if (visited.has(normalized))
      throw new ConnectorError("REDIRECT_LOOP", "The discovery URL returned a loop.", false);
    visited.add(normalized);
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 8_000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    let response: Response;
    try {
      response = await fetcher(url, {
        method: "GET",
        redirect: "manual",
        signal,
        headers: {
          accept: "text/html, application/json;q=0.9, application/ld+json;q=0.9, text/plain;q=0.5",
          "user-agent": "FirstSeen/1.0 (+official source verification)",
        },
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new ConnectorError(
        timedOut ? "REDIRECT_TIMEOUT" : "REDIRECT_NETWORK_FAILED",
        timedOut ? "The discovery redirect timed out." : "The discovery redirect request failed.",
        true,
      );
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > maximumRedirectBodyBytes)
        throw new ConnectorError(
          "REDIRECT_BODY_TOO_LARGE",
          "The discovery redirect response was too large.",
          false,
        );
      await response.body?.cancel().catch(() => undefined);
      const location = response.headers.get("location");
      if (!location)
        throw new ConnectorError(
          "INVALID_REDIRECT",
          "The discovery URL returned an invalid redirect.",
          false,
        );
      if (redirectCount === maximumRedirects)
        throw new ConnectorError(
          "TOO_MANY_REDIRECTS",
          "The discovery URL redirected too many times.",
          false,
        );
      current = new URL(location, url).toString();
      continue;
    }

    const contentType =
      response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
    await response.body?.cancel().catch(() => undefined);
    if (contentType && !FINAL_CONTENT_TYPES.has(contentType))
      throw new ConnectorError(
        "UNSUPPORTED_CONTENT_TYPE",
        "The discovery destination returned an unsupported content type.",
        false,
        response.status,
      );
    if (response.status === 429 || response.status >= 500)
      throw new ConnectorError(
        response.status === 429 ? "SOURCE_RATE_LIMITED" : "SOURCE_UNAVAILABLE",
        "The discovery destination is temporarily unavailable.",
        true,
        response.status,
      );
    return { url: normalized, status: response.status, contentType, redirectCount };
  }

  throw new ConnectorError("REDIRECT_FAILED", "The discovery redirect failed.", false);
}
