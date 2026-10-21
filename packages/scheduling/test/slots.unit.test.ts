import { describe, expect, it } from "vitest";
import { boundaryInstant, localTime, resolveLocal, toZonedIso, zoneAbbreviation } from "@projectos/shared";
import { checkCandidate, expandTemplates, generateSlots, type SlotInput } from "../src/slots";

const NY = "America/New_York";
const zones = new Map([["s1", NY]]);
const tpl = (o: Partial<Parameters<typeof expandTemplates>[0][number]> = {}) => ({
  practitionerId: "p1",
  siteId: "s1",
  weekday: 1,
  startTime: "09:00:00",
  endTime: "12:00:00",
  modalities: ["IN_PERSON", "VIDEO"],
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  ...o,
});
const type = { durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 10, requiresRoom: false, minNoticeMinutes: 0, maxDaysOut: 365 };
const base = (o: Partial<SlotInput> = {}): SlotInput => ({
  blocks: expandTemplates([tpl()], zones, "2027-03-15", 1), // Monday
  type,
  modality: "IN_PERSON",
  practitionerBusy: new Map(),
  practitionerExceptions: new Map(),
  siteClosures: new Map(),
  rooms: [],
  now: new Date("2027-03-01T00:00:00Z"),
  stepMinutes: 15,
  ...o,
});

describe("local time resolution (SCH-03 / SCH-04)", () => {
  it("spring-forward: 02:30 does not exist in New York on 2027-03-14", () => {
    expect(resolveLocal("2027-03-14", "02:30", NY).kind).toBe("gap");
    expect(resolveLocal("2027-03-14", "03:30", NY)).toEqual({ kind: "ok", instant: new Date("2027-03-14T07:30:00Z") });
  });
  it("fall-back: 01:30 happens twice on 2026-11-01 and both carry explicit offsets", () => {
    const r = resolveLocal("2026-11-01", "01:30", NY);
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") return;
    expect(r.instants.map((d) => d.toISOString())).toEqual(["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]);
    expect(r.instants.map((d) => toZonedIso(d, NY))).toEqual(["2026-11-01T01:30:00-04:00", "2026-11-01T01:30:00-05:00"]);
    expect(r.instants.map((d) => zoneAbbreviation(d, NY))).toEqual(["EDT", "EST"]);
  });
  it("ordinary times resolve uniquely in summer and winter", () => {
    expect(resolveLocal("2026-07-01", "09:00", NY)).toEqual({ kind: "ok", instant: new Date("2026-07-01T13:00:00Z") });
    expect(resolveLocal("2026-12-01", "09:00", NY)).toEqual({ kind: "ok", instant: new Date("2026-12-01T14:00:00Z") });
  });
  it("schedule boundaries: a gap start moves to 03:00; an ambiguous end takes the later instant", () => {
    expect(boundaryInstant("2027-03-14", "02:00", NY, "start").toISOString()).toBe("2027-03-14T07:00:00.000Z");
    expect(boundaryInstant("2026-11-01", "01:30", NY, "end").toISOString()).toBe("2026-11-01T06:30:00.000Z");
  });
});

describe("template expansion across DST", () => {
  it("spring-forward day: a 01:00–04:00 block is 2 real hours and offers no 02:xx slot", () => {
    const blocks = expandTemplates([tpl({ weekday: 0, startTime: "01:00:00", endTime: "04:00:00" })], zones, "2027-03-14", 1);
    expect(blocks).toHaveLength(1);
    expect((blocks[0]!.end.getTime() - blocks[0]!.start.getTime()) / 3600_000).toBe(2);
    const slots = generateSlots(base({ blocks }));
    expect(slots.some((s) => s.localStart.startsWith("02:"))).toBe(false);
    expect(slots[0]!.localStart).toBe("01:00");
  });
  it("fall-back day: a 00:00–03:00 block is 4 real hours; the repeated 01:xx slots are distinguished by zone", () => {
    const blocks = expandTemplates([tpl({ weekday: 0, startTime: "00:00:00", endTime: "03:00:00" })], zones, "2026-11-01", 1);
    expect((blocks[0]!.end.getTime() - blocks[0]!.start.getTime()) / 3600_000).toBe(4);
    const slots = generateSlots(base({ blocks, now: new Date("2026-10-01T00:00:00Z") }));
    const at0130 = slots.filter((s) => s.localStart === "01:30");
    expect(at0130.map((s) => s.zone)).toEqual(["EDT", "EST"]);
  });
  it("respects weekday and effective dates", () => {
    expect(expandTemplates([tpl({ weekday: 2 })], zones, "2027-03-15", 1)).toHaveLength(0);
    expect(expandTemplates([tpl({ effectiveFrom: "2027-04-01" })], zones, "2027-03-15", 1)).toHaveLength(0);
    expect(expandTemplates([tpl({ effectiveTo: "2027-03-14" })], zones, "2027-03-15", 1)).toHaveLength(0);
  });
});

describe("slot rules", () => {
  it("a 30-min visit fits 09:00…11:30 on a 15-min grid inside 09–12", () => {
    const s = generateSlots(base());
    expect(s[0]!.localStart).toBe("09:00");
    expect(s.at(-1)!.localStart).toBe("11:30");
    expect(s).toHaveLength(11);
  });
  it("buffers: an appointment reserved 10:00–10:40 blocks starts 09:45 to 10:30 (buffer overlap)", () => {
    const busy = new Map([["p1", [{ start: new Date("2027-03-15T14:00:00Z"), end: new Date("2027-03-15T14:40:00Z") }]]]);
    const s = generateSlots(base({ practitionerBusy: busy })).map((x) => localTime(x.startAt, NY));
    expect(s).not.toContain("09:45"); // 09:45–10:15 (+10) overlaps
    expect(s).not.toContain("10:30");
    expect(s).toContain("09:15"); // ends 09:45, buffered to 09:55 — fine
    expect(s).toContain("10:45");
  });
  it("time off, closures, notice, horizon and modality each block with a reason", () => {
    const start = new Date("2027-03-15T14:00:00Z");
    const off = { start: new Date("2027-03-15T13:00:00Z"), end: new Date("2027-03-15T17:00:00Z") };
    expect(checkCandidate(base({ practitionerExceptions: new Map([["p1", [off]]]) }), "p1", "s1", start)).toEqual({ ok: false, reason: "PROVIDER_TIME_OFF" });
    expect(checkCandidate(base({ siteClosures: new Map([["s1", [off]]]) }), "p1", "s1", start)).toEqual({ ok: false, reason: "SITE_CLOSED" });
    expect(checkCandidate(base({ now: new Date("2027-03-15T13:59:00Z"), type: { ...type, minNoticeMinutes: 60 } }), "p1", "s1", start)).toEqual({
      ok: false,
      reason: "TOO_SOON",
    });
    expect(checkCandidate(base({ type: { ...type, maxDaysOut: 7 } }), "p1", "s1", start)).toEqual({ ok: false, reason: "TOO_FAR_OUT" });
    expect(checkCandidate(base({ modality: "AUDIO_ONLY" }), "p1", "s1", start)).toEqual({ ok: false, reason: "MODALITY_NOT_OFFERED" });
    expect(checkCandidate(base(), "p1", "s1", new Date("2027-03-15T18:00:00Z"))).toEqual({ ok: false, reason: "OUTSIDE_WORKING_HOURS" });
  });
  it("rooms: picks the first free room; no free room → NO_ROOM", () => {
    const busyRange = { start: new Date("2027-03-15T14:00:00Z"), end: new Date("2027-03-15T15:00:00Z") };
    const rooms = [
      { id: "r1", code: "EX-1", siteId: "s1", busy: [busyRange] },
      { id: "r2", code: "EX-2", siteId: "s1", busy: [] },
    ];
    const t = { ...type, requiresRoom: true };
    const c = checkCandidate(base({ type: t, rooms }), "p1", "s1", new Date("2027-03-15T14:00:00Z"));
    expect(c).toMatchObject({ ok: true, roomId: "r2" });
    const c2 = checkCandidate(base({ type: t, rooms: [rooms[0]!] }), "p1", "s1", new Date("2027-03-15T14:00:00Z"));
    expect(c2).toEqual({ ok: false, reason: "NO_ROOM" });
    // Video visits never need a room.
    expect(checkCandidate(base({ type: t, rooms: [rooms[0]!], modality: "VIDEO" }), "p1", "s1", new Date("2027-03-15T14:00:00Z"))).toMatchObject({ ok: true, roomId: null });
  });
});
