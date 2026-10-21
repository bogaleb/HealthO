import { addDays, boundaryInstant, localTime, minutesOf, weekdayOf, zoneAbbreviation, type Modality } from "@projectos/shared";

/** Pure availability math (no DB, no clock): shared by search, booking re-validation and tests. */

export interface Range {
  start: Date;
  end: Date;
}
export const overlaps = (a: Range, b: Range) => a.start < b.end && b.start < a.end;

export interface TemplateLike {
  practitionerId: string;
  siteId: string;
  weekday: number;
  startTime: string; // HH:MM[:SS]
  endTime: string;
  modalities: string[];
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface WorkingBlock extends Range {
  practitionerId: string;
  siteId: string;
  date: string; // local date at the site
  timeZone: string;
  modalities: string[];
  label: string; // e.g. "Tue 09:00–12:00"
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hm = (t: string) => t.slice(0, 5);

/**
 * Expand weekly templates into concrete UTC working blocks for local dates [fromDate, fromDate+days).
 * DST: boundaries in a spring-forward gap move to the first existing instant; on fall-back the block
 * spans the full repeated hour (see boundaryInstant). Blocks never silently disappear.
 */
export function expandTemplates(templates: TemplateLike[], siteZones: Map<string, string>, fromDate: string, days: number): WorkingBlock[] {
  const out: WorkingBlock[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(fromDate, i);
    const wd = weekdayOf(date);
    for (const t of templates) {
      if (t.weekday !== wd || date < t.effectiveFrom || (t.effectiveTo && date > t.effectiveTo)) continue;
      const tz = siteZones.get(t.siteId);
      if (!tz) continue;
      const start = boundaryInstant(date, hm(t.startTime), tz, "start");
      const end = boundaryInstant(date, hm(t.endTime), tz, "end");
      if (end <= start) continue;
      out.push({
        practitionerId: t.practitionerId,
        siteId: t.siteId,
        date,
        timeZone: tz,
        start,
        end,
        modalities: t.modalities,
        label: `${WD[wd]} ${hm(t.startTime)}–${hm(t.endTime)}`,
      });
    }
  }
  return out;
}

export interface TypeLike {
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  requiresRoom: boolean;
  minNoticeMinutes: number;
  maxDaysOut: number;
}

/** Visit range and the reserved (buffered) range for a start instant. */
export function rangesFor(type: TypeLike, start: Date) {
  const end = new Date(start.getTime() + type.durationMinutes * 60_000);
  return {
    visit: { start, end },
    reserved: { start: new Date(start.getTime() - type.bufferBeforeMinutes * 60_000), end: new Date(end.getTime() + type.bufferAfterMinutes * 60_000) },
  };
}

export interface RoomLike {
  id: string;
  code: string;
  siteId: string;
  busy: Range[];
}

export interface SlotInput {
  blocks: WorkingBlock[];
  type: TypeLike;
  modality: Modality;
  /** Active reservations (buffered ranges) per practitioner. */
  practitionerBusy: Map<string, Range[]>;
  /** PTO/BLOCK per practitioner, CLOSURE per site. */
  practitionerExceptions: Map<string, Range[]>;
  siteClosures: Map<string, Range[]>;
  rooms: RoomLike[];
  now: Date;
  stepMinutes: number;
  limitPerDay?: number;
}

export interface Slot {
  practitionerId: string;
  siteId: string;
  date: string;
  timeZone: string;
  startAt: Date;
  endAt: Date;
  localStart: string;
  zone: string; // EDT / EST — explicit so repeated fall-back hours are distinguishable
  roomId: string | null;
  roomCode: string | null;
  reasons: string[];
}

export type Unavailable = "OUTSIDE_WORKING_HOURS" | "MODALITY_NOT_OFFERED" | "TOO_SOON" | "TOO_FAR_OUT" | "PROVIDER_TIME_OFF" | "SITE_CLOSED" | "PROVIDER_BUSY" | "NO_ROOM";

export const UNAVAILABLE_MESSAGE: Record<Unavailable, string> = {
  OUTSIDE_WORKING_HOURS: "Outside the provider's working hours at this site.",
  MODALITY_NOT_OFFERED: "The provider does not offer this visit modality in this working block.",
  TOO_SOON: "Inside the appointment type's minimum booking notice.",
  TOO_FAR_OUT: "Beyond the appointment type's booking horizon.",
  PROVIDER_TIME_OFF: "The provider has time off or blocked time.",
  SITE_CLOSED: "The site is closed.",
  PROVIDER_BUSY: "Another appointment or hold occupies this provider and time (including buffers).",
  NO_ROOM: "No room is free at this site for the full visit.",
};

/**
 * Check one candidate start for a practitioner/site. Returns the first reason it is unavailable, or the
 * room it would use. Used by search (for every grid point) and by booking (inside the transaction).
 */
export function checkCandidate(
  input: Omit<SlotInput, "stepMinutes" | "limitPerDay">,
  practitionerId: string,
  siteId: string,
  start: Date,
  roomId?: string | null,
): { ok: true; block: WorkingBlock; roomId: string | null; roomCode: string | null } | { ok: false; reason: Unavailable } {
  const { visit, reserved } = rangesFor(input.type, start);
  const blocks = input.blocks.filter((b) => b.practitionerId === practitionerId && b.siteId === siteId && b.start <= visit.start && visit.end <= b.end);
  if (!blocks.length) return { ok: false, reason: "OUTSIDE_WORKING_HOURS" };
  const block = blocks.find((b) => b.modalities.includes(input.modality));
  if (!block) return { ok: false, reason: "MODALITY_NOT_OFFERED" };
  if (start.getTime() < input.now.getTime() + input.type.minNoticeMinutes * 60_000) return { ok: false, reason: "TOO_SOON" };
  if (start.getTime() > input.now.getTime() + input.type.maxDaysOut * 86_400_000) return { ok: false, reason: "TOO_FAR_OUT" };
  if ((input.siteClosures.get(siteId) ?? []).some((r) => overlaps(r, visit))) return { ok: false, reason: "SITE_CLOSED" };
  if ((input.practitionerExceptions.get(practitionerId) ?? []).some((r) => overlaps(r, visit))) return { ok: false, reason: "PROVIDER_TIME_OFF" };
  if ((input.practitionerBusy.get(practitionerId) ?? []).some((r) => overlaps(r, reserved))) return { ok: false, reason: "PROVIDER_BUSY" };
  const needsRoom = input.type.requiresRoom && input.modality === "IN_PERSON";
  if (needsRoom || roomId) {
    const candidates = input.rooms.filter((r) => r.siteId === siteId && (!roomId || r.id === roomId));
    const free = candidates.find((r) => !r.busy.some((b) => overlaps(b, reserved)));
    if (!free) return { ok: false, reason: "NO_ROOM" };
    return { ok: true, block, roomId: free.id, roomCode: free.code };
  }
  return { ok: true, block, roomId: null, roomCode: null };
}

/** All bookable starts on a step grid inside each working block. */
export function generateSlots(input: SlotInput): Slot[] {
  const out: Slot[] = [];
  const perDay = new Map<string, number>();
  const step = input.stepMinutes * 60_000;
  const dur = input.type.durationMinutes * 60_000;
  const bufferNote =
    input.type.bufferBeforeMinutes || input.type.bufferAfterMinutes ? ` (incl. ${input.type.bufferBeforeMinutes}/${input.type.bufferAfterMinutes}-min buffers)` : "";
  for (const b of [...input.blocks].sort((x, y) => x.start.getTime() - y.start.getTime())) {
    if (!b.modalities.includes(input.modality)) continue;
    for (let t = b.start.getTime(); t + dur <= b.end.getTime(); t += step) {
      const key = `${b.date}:${b.practitionerId}`;
      if (input.limitPerDay && (perDay.get(key) ?? 0) >= input.limitPerDay) break;
      const start = new Date(t);
      const c = checkCandidate(input, b.practitionerId, b.siteId, start);
      if (!c.ok) continue;
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
      const reasons = [`Works ${b.label} at this site (${b.timeZone})`, `No overlapping appointment, hold, time off or closure${bufferNote}`];
      if (c.roomCode) reasons.push(`Room ${c.roomCode} is free`);
      out.push({
        practitionerId: b.practitionerId,
        siteId: b.siteId,
        date: b.date,
        timeZone: b.timeZone,
        startAt: start,
        endAt: new Date(t + dur),
        localStart: localTime(start, b.timeZone),
        zone: zoneAbbreviation(start, b.timeZone),
        roomId: c.roomId,
        roomCode: c.roomCode,
        reasons,
      });
    }
  }
  return out.sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.practitionerId.localeCompare(b.practitionerId));
}

/** Sanity helper for forms: is HH:MM a valid grid time. */
export const onGrid = (time: string, step: number) => minutesOf(time) % step === 0;
