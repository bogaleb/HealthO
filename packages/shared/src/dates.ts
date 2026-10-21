/** Today's calendar date (YYYY-MM-DD) in an IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a YYYY-MM-DD date (calendar arithmetic, no TZ). */
export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}
