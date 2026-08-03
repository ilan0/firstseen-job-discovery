export function zonedParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    localDate: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  };
}
export function inQuietHours(hour: number, start: number, end: number) {
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}
export function hoursUntilQuietEnd(hour: number, start: number, end: number) {
  if (!inQuietHours(hour, start, end)) return 0;
  if (start > end) return hour >= start ? 24 - hour + end : end - hour;
  return end - hour;
}
