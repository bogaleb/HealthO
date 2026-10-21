/**
 * DST-safe conversions between wall-clock times in an IANA zone and UTC instants.
 * Pure functions (Intl only) so they run identically on the server, in tests and in the browser.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string) {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a zone. */
export function zonedParts(instant: Date, timeZone: string) {
  const parts = dtf(timeZone).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** UTC offset of the zone at an instant, in minutes (e.g. -240 for EDT). */
export function offsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  const a = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** ISO 8601 with the zone's explicit offset, e.g. 2026-11-01T01:30:00-04:00. */
export function toZonedIso(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  const off = offsetMinutes(instant, timeZone);
  const sign = off < 0 ? "-" : "+";
  const a = Math.abs(off);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export type LocalResolution =
  | { kind: "ok"; instant: Date }
  | { kind: "gap"; instants: [] } // e.g. 02:30 on spring-forward day: this wall time does not exist
  | { kind: "ambiguous"; instants: [Date, Date] }; // e.g. 01:30 on fall-back day: happens twice

/**
 * Resolve a local wall-clock time (YYYY-MM-DD + HH:MM) in a zone to UTC.
 * Never guesses: a nonexistent time is reported as a gap and a repeated time as ambiguous (earlier first).
 */
export function resolveLocal(date: string, time: string, timeZone: string): LocalResolution {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsets = new Set<number>();
  for (const delta of [-36, -12, 0, 12, 36]) offsets.add(offsetMinutes(new Date(guess + delta * 3600_000), timeZone));
  const hits: Date[] = [];
  for (const off of offsets) {
    const inst = new Date(guess - off * 60_000);
    const p = zonedParts(inst, timeZone);
    if (p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi && !hits.some((x) => x.getTime() === inst.getTime())) hits.push(inst);
  }
  hits.sort((a, b) => a.getTime() - b.getTime());
  if (hits.length === 0) return { kind: "gap", instants: [] };
  if (hits.length === 1) return { kind: "ok", instant: hits[0]! };
  return { kind: "ambiguous", instants: [hits[0]!, hits[1]!] };
}

/**
 * For schedule boundaries (template start/end): a gap resolves to the first instant after the jump,
 * an ambiguous time resolves to the earlier occurrence for a start and the later one for an end,
 * so a working block never silently shrinks or doubles.
 */
export function boundaryInstant(date: string, time: string, timeZone: string, edge: "start" | "end"): Date {
  const r = resolveLocal(date, time, timeZone);
  if (r.kind === "ok") return r.instant;
  if (r.kind === "ambiguous") return edge === "start" ? r.instants[0] : r.instants[1];
  // gap: walk forward minute by minute (max 3h) to the first existing wall time
  const [h, mi] = time.split(":").map(Number) as [number, number];
  for (let m = 1; m <= 180; m++) {
    const t = h * 60 + mi + m;
    const rr = resolveLocal(date, `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`, timeZone);
    if (rr.kind !== "gap") return rr.kind === "ok" ? rr.instant : rr.instants[0];
  }
  throw new RangeError("Could not resolve local time");
}

/** Local calendar date (YYYY-MM-DD) of an instant in a zone. */
export function localDate(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "HH:MM" wall time of an instant in a zone. */
export function localTime(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Short zone abbreviation at an instant (EDT/EST/…), falling back to the numeric offset. */
export function zoneAbbreviation(instant: Date, timeZone: string): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(instant).find((p) => p.type === "timeZoneName")?.value;
  return name && !name.startsWith("GMT") ? name : formatOffset(offsetMinutes(instant, timeZone));
}

/** Minutes since local midnight for "HH:MM". */
export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}
