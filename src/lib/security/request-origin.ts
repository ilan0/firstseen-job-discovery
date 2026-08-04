export function hasTrustedMutationOrigin(request: Request, configuredAppUrl: string) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin, new URL(configuredAppUrl).origin]);
  return allowed.has(origin);
}
