export function sourceFailureCode(error: unknown) {
  let current = error;
  let explicit: unknown = null;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    if ("code" in current && typeof (current as { code?: unknown }).code === "string") {
      explicit = (current as { code: string }).code;
      break;
    }
    current = "cause" in current ? (current as { cause?: unknown }).cause : null;
  }
  if (explicit === null && error instanceof Error) {
    explicit = error.message.match(/^\[([A-Z0-9_]{1,80})\]/)?.[1] ?? null;
  }
  const candidate =
    typeof explicit === "string" && explicit.length > 0
      ? explicit
      : error instanceof Error
        ? error.name
        : "ERROR";
  return candidate
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .slice(0, 80);
}
