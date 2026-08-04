const validationOrigin = "https://firstseen.invalid";

function repeatedlyDecoded(value: string) {
  let decoded = value;
  for (let count = 0; count < 3; count += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return null;
    }
  }
  return decoded;
}

/** Returns a normalized same-origin app path, or null for redirect-like input. */
export function safeAppPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 2_000) return null;
  const decoded = repeatedlyDecoded(value);
  if (
    !decoded ||
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(decoded)
  )
    return null;
  try {
    const destination = new URL(value, validationOrigin);
    return destination.origin === validationOrigin
      ? `${destination.pathname}${destination.search}${destination.hash}`
      : null;
  } catch {
    return null;
  }
}
