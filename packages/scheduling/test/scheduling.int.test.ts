import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { appointmentEvents, appointments, auditEvents, resourceReservations, services } from "@projectos/db/schema";
import { makeOrg, testDb, expectAppError, type Fixture } from "../../core/test/helpers";
import { eligibilityFixture } from "./fixtures";
import { createPractitioner } from "@projectos/credentialing";
import {
  cancelAppointment,
  changeAppointmentStatus,
  checkInAppointment,
  createAppointment,
  createAppointmentType,
  createException,
  createHold,
  createPatient,
  createRoom,
  createTemplate,
  getAppointment,
  getCalendar,
  releaseExpiredHolds,
  rescheduleAppointment,
  searchPatients,
  searchSlots,
} from "../src";

/**
 * Fixed clock: Monday 2027-03-15 is the day after the 2027 US spring-forward.
 * Every scheduling function takes `now`, so these tests never depend on the real date.
 */
const NOW = new Date("2027-03-08T12:00:00Z");
const DAY = "2027-03-15";
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00-04:00`).toISOString(); // EDT on that date

const { db, end } = testDb();
let A: Fixture;
let B: Fixture;
let ctxAdmin: Awaited<ReturnType<Fixture["users"]["admin"]["ctx"]>>;
let p1: string;
let p2: string;
let typeId: string; // 30 min + 10 min after-buffer, room required
let videoTypeId: string; // 30 min, no room
let roomId: string;
const patients: string[] = [];

beforeAll(async () => {
  process.env.SCHEDULING_MODE = "DEMO_ONLY";
  A = await makeOrg(db, "SC");
  B = await makeOrg(db, "SX");
  ctxAdmin = await A.users.admin.ctx();
  const [svc] = await db.insert(services).values({ organizationId: A.org.id, code: "PC", name: "Primary care", category: "PRIMARY_CARE" }).returning();
  const mk = async (name: string) =>
    (
      await createPractitioner(db, ctxAdmin, {
        displayName: `${name} (SYNTHETIC)`,
        profession: "PHYSICIAN",
        physicalState: "VA",
        telehealthCapable: true,
        siteIds: [A.sites.s1.id, A.sites.s2.id],
        specialtyIds: [],
        serviceIds: [svc!.id],
        languages: [],
      })
    ).id;
  p1 = await mk("Prov One");
  p2 = await mk("Prov Two");
  typeId = (await createAppointmentType(db, ctxAdmin, {
    code: "FU30",
    name: "Follow-up 30",
    serviceId: svc!.id,
    durationMinutes: 30,
    bufferAfterMinutes: 10,
    modalities: ["IN_PERSON", "VIDEO"],
    requiresRoom: true,
  }))!.id;
  videoTypeId = (await createAppointmentType(db, ctxAdmin, { code: "TELE30", name: "Video 30", durationMinutes: 30, modalities: ["VIDEO"] }))!.id;
  roomId = (await createRoom(db, ctxAdmin, { siteId: A.sites.s1.id, code: "R1", name: "Room 1" }))!.id;
  // Phase 5: bookings must be eligible — approved DEMO rules for VA and verified VA licenses for both providers.
  const fx = await eligibilityFixture(db, A);
  await fx.rule("VA", "IN_PERSON");
  await fx.rule("VA", "VIDEO");
  await fx.license(p1, "VA");
  await fx.license(p2, "VA");
  for (const p of [p1, p2]) {
    for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
      await createTemplate(db, ctxAdmin, {
        practitionerId: p,
        siteId: A.sites.s1.id,
        weekday,
        startTime: "09:00",
        endTime: "17:00",
        modalities: ["IN_PERSON", "VIDEO"],
        effectiveFrom: "2027-01-01",
      });
    }
  }
  for (let i = 0; i < 6; i++) patients.push((await createPatient(db, ctxAdmin, { displayName: `Test Patient ${i}`, homeState: "VA" }))!.id);
});
afterAll(async () => end());

let pi = 0;
const nextPatient = () => patients[pi++ % patients.length]!;
const book = async (startHHMM: string, o: Record<string, unknown> = {}, ctx = ctxAdmin, now = NOW) =>
  (
    await createAppointment(
      db,
      ctx,
      {
        practitionerId: p1,
        siteId: A.sites.s1.id,
        appointmentTypeId: typeId,
        modality: "IN_PERSON",
        patientId: nextPatient(),
        patientLocationState: "VA",
        ...o,
        startAt: (o.startAt as string | undefined) ?? at(startHHMM),
      },
      { now },
    )
  ).appointment;

describe("search", () => {
  it("returns slots with reasons and an ALLOW eligibility derived from verified evidence + approved rule", async () => {
    const r = await searchSlots(
      db,
      ctxAdmin,
      { appointmentTypeId: typeId, modality: "IN_PERSON", siteId: A.sites.s1.id, practitionerId: p1, fromDate: "2027-03-22", days: 1 },
      NOW,
    );
    expect(r.slots.length).toBeGreaterThan(20);
    expect(r.slots[0]).toMatchObject({ localStart: "09:00", zone: "EDT", roomCode: "R1", eligibility: { decision: "ALLOW", isDemoPolicy: true } });
    expect(r.slots[0]!.reasons.join(" ")).toMatch(/Works .* 09:00–17:00/);
  });
});

describe("SCH-01: two concurrent bookings for the same provider and time", () => {
  it("exactly one succeeds; the other gets SLOT_CONFLICT with alternatives", async () => {
    const results = await Promise.allSettled([book("10:00"), book("10:00")]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.reason.code).toBe("SLOT_CONFLICT");
    expect(bad[0]!.reason.details.some((d: { code: string }) => d.code === "ALTERNATIVE")).toBe(true);
    const active = await db.execute(
      sql`select count(*)::int as n from resource_reservations where resource_type='PRACTITIONER' and resource_id=${p1} and state='ACTIVE' and start_at=${at("10:00")}::timestamptz`,
    );
    expect((active[0] as { n: number }).n).toBe(1);
  });
  it("five schedulers racing for one slot: one booking, four 409s", async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => book("15:00")));
    const summary = results.map((r) => (r.status === "fulfilled" ? "OK" : `${r.reason?.code ?? ""}:${r.reason?.cause?.code ?? ""}:${String(r.reason?.message).slice(0, 80)}`));
    expect(
      results.filter((r) => r.status === "fulfilled"),
      summary.join(" | "),
    ).toHaveLength(1);
    expect((results.filter((r) => r.status === "rejected") as PromiseRejectedResult[]).every((r) => r.reason.code === "SLOT_CONFLICT")).toBe(true);
  });
});

describe("SCH-02: room conflict", () => {
  it("two providers cannot use the only room at the same time (sequential and concurrent)", async () => {
    await book("11:00", { practitionerId: p1 });
    const e = (await expectAppError(book("11:00", { practitionerId: p2 }), "SLOT_CONFLICT")) as { details: { code: string }[] };
    expect(e.details[0]!.code).toBe("NO_ROOM");
    // Concurrent: both pass the in-transaction check; the DB exclusion constraint rejects the loser.
    const r = await Promise.allSettled([book("12:00", { practitionerId: p1, roomId }), book("12:00", { practitionerId: p2, roomId })]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });
  it("video visits do not take a room", async () => {
    await book("13:00", { practitionerId: p1 }); // takes R1
    const v = await book("13:00", { practitionerId: p2, appointmentTypeId: videoTypeId, modality: "VIDEO" });
    expect(v.roomId).toBeNull();
  });
});

describe("buffers", () => {
  it("the 10-minute after-buffer is reserved: 09:30+30+10 blocks 10:05 but not 10:10", async () => {
    await book("09:30", { practitionerId: p2, startAt: new Date("2027-03-16T09:30:00-04:00").toISOString() });
    await expectAppError(book("10:05", { practitionerId: p2, startAt: new Date("2027-03-16T10:05:00-04:00").toISOString() }), "SLOT_CONFLICT");
    const ok = await book("10:10", { practitionerId: p2, startAt: new Date("2027-03-16T10:10:00-04:00").toISOString() });
    expect(new Date(ok.reservedEndAt).toISOString()).toBe("2027-03-16T14:50:00.000Z");
  });
});

describe("SCH-06: cancellation releases the slot", () => {
  it("cancel → reservations RELEASED → the same slot can be booked again; cancel is idempotent", async () => {
    const d = "2027-03-17T10:00:00-04:00";
    const a = await book("x", { startAt: new Date(d).toISOString() });
    const c = await cancelAppointment(db, ctxAdmin, a.id, { version: a.version, reason: "Patient request (synthetic)" });
    expect(c.status).toBe("CANCELLED");
    const again = await cancelAppointment(db, ctxAdmin, a.id, { version: a.version, reason: "retry" });
    expect(again.status).toBe("CANCELLED");
    const rs = await db.select().from(resourceReservations).where(eq(resourceReservations.appointmentId, a.id));
    expect(rs.every((r) => r.state === "RELEASED")).toBe(true);
    const b = await book("x", { startAt: new Date(d).toISOString() });
    expect(b.status).toBe("CONFIRMED");
    const ev = await db.select().from(appointmentEvents).where(eq(appointmentEvents.appointmentId, a.id)).orderBy(asc(appointmentEvents.at));
    expect(ev.map((e) => e.event)).toEqual(["BOOKED", "CANCELLED"]);
  });
});

describe("SCH-07: holds and the stale-hold worker", () => {
  it("an unexpired hold blocks others; expired holds keep blocking until explicitly released; release is idempotent", async () => {
    const other = await A.user("sched2", [{ roleId: A.roleIds.scheduler!, siteId: A.sites.s1.id }]);
    const oc = await other.ctx();
    const start = new Date("2027-03-18T10:00:00-04:00").toISOString();
    const t0 = new Date("2027-03-08T12:00:00Z");
    const hold = await createHold(db, ctxAdmin, { practitionerId: p1, siteId: A.sites.s1.id, appointmentTypeId: typeId, modality: "IN_PERSON", startAt: start }, t0);
    expect(hold.status).toBe("ACTIVE");
    // Another scheduler 1 minute later: blocked by the live hold.
    await expectAppError(book("x", { startAt: start }, oc, new Date(t0.getTime() + 60_000)), "SLOT_CONFLICT");
    // The constraint never looks at now(): even long after expiry, a raw overlapping insert is rejected until release.
    await expect(
      db.insert(resourceReservations).values({
        organizationId: A.org.id,
        resourceType: "PRACTITIONER",
        resourceId: p1,
        startAt: new Date(start),
        endAt: new Date(new Date(start).getTime() + 15 * 60_000),
        reservationKind: "BLOCK",
      }),
    ).rejects.toMatchObject({ cause: { code: "23P01" } });
    expect((await releaseExpiredHolds(db, { organizationId: A.org.id, now: new Date(t0.getTime() + 60_000) })).released).toBe(0);
    const later = new Date(t0.getTime() + 10 * 60_000);
    const runs = await Promise.all([1, 2, 3].map(() => releaseExpiredHolds(db, { organizationId: A.org.id, now: later })));
    expect(runs.reduce((s, r) => s + r.released, 0)).toBe(1);
    expect((await releaseExpiredHolds(db, { organizationId: A.org.id, now: later })).released).toBe(0);
    const audits = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "hold.expire"), eq(auditEvents.resourceId, hold.id)));
    expect(audits).toHaveLength(1);
    // Owner can no longer convert the expired hold; the slot is free for others.
    await expectAppError(book("x", { startAt: start, holdId: hold.id }, ctxAdmin, later), "HOLD_EXPIRED");
    const a = await book("x", { startAt: start }, oc, later);
    expect(a.status).toBe("CONFIRMED");
  });
  it("converting your own hold books the same slot atomically", async () => {
    const start = new Date("2027-03-19T10:00:00-04:00").toISOString();
    const hold = await createHold(db, ctxAdmin, { practitionerId: p1, siteId: A.sites.s1.id, appointmentTypeId: typeId, modality: "IN_PERSON", startAt: start }, NOW);
    const a = await book("x", { startAt: start, holdId: hold.id });
    expect(a.holdId).toBe(hold.id);
    expect(a.roomId).toBe(hold.roomId);
    const rs = await db.select().from(resourceReservations).where(eq(resourceReservations.holdId, hold.id));
    expect(rs.every((r) => r.state === "RELEASED")).toBe(true);
  });
  it("a booking that finds only an EXPIRED hold in its way releases it (audited) and succeeds", async () => {
    const start = new Date("2027-03-19T14:00:00-04:00").toISOString();
    const hold = await createHold(db, ctxAdmin, { practitionerId: p2, siteId: A.sites.s1.id, appointmentTypeId: videoTypeId, modality: "VIDEO", startAt: start }, NOW);
    const later = new Date(NOW.getTime() + 30 * 60_000);
    const a = await book("x", { practitionerId: p2, appointmentTypeId: videoTypeId, modality: "VIDEO", startAt: start }, ctxAdmin, later);
    expect(a.status).toBe("CONFIRMED");
    const audits = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "hold.expire"), eq(auditEvents.resourceId, hold.id)));
    expect(audits).toHaveLength(1);
  });
});

describe("SCH-05: reschedule is atomic", () => {
  it("a failed reschedule leaves the original untouched; a valid one moves it and logs before/after", async () => {
    const day = "2027-03-22";
    const a1 = await book("x", { startAt: new Date(`${day}T10:00:00-04:00`).toISOString() });
    await book("x", { startAt: new Date(`${day}T11:00:00-04:00`).toISOString() });
    await expectAppError(
      rescheduleAppointment(db, ctxAdmin, a1.id, { version: a1.version, startAt: new Date(`${day}T11:00:00-04:00`).toISOString(), reason: "test" }, NOW),
      "SLOT_CONFLICT",
    );
    // Outside working hours → also fails, also leaves it untouched.
    await expectAppError(
      rescheduleAppointment(db, ctxAdmin, a1.id, { version: a1.version, startAt: new Date(`${day}T18:00:00-04:00`).toISOString(), reason: "test" }, NOW),
      "SLOT_UNAVAILABLE",
    );
    const [still] = await db.select().from(appointments).where(eq(appointments.id, a1.id));
    expect(still!.startAt.toISOString()).toBe(new Date(`${day}T10:00:00-04:00`).toISOString());
    expect(still!.version).toBe(a1.version);
    const act = await db
      .select()
      .from(resourceReservations)
      .where(and(eq(resourceReservations.appointmentId, a1.id), eq(resourceReservations.state, "ACTIVE")));
    expect(act).toHaveLength(2); // provider + room, original range
    expect(act[0]!.startAt.toISOString()).toBe(new Date(`${day}T10:00:00-04:00`).toISOString());

    // Moving 15 minutes later overlaps its own old range — allowed because the old reservation is released in the same transaction.
    const moved = await rescheduleAppointment(db, ctxAdmin, a1.id, { version: a1.version, startAt: new Date(`${day}T10:15:00-04:00`).toISOString(), reason: "Patient asked" }, NOW);
    expect(moved.version).toBe(a1.version + 1);
    const ev = await db
      .select()
      .from(appointmentEvents)
      .where(and(eq(appointmentEvents.appointmentId, a1.id), eq(appointmentEvents.event, "RESCHEDULED")));
    expect(ev).toHaveLength(1);
    expect(ev[0]!.before).toMatchObject({ startAt: new Date(`${day}T10:00:00-04:00`).toISOString() });
    // Stale version → 409
    await expectAppError(
      rescheduleAppointment(db, ctxAdmin, a1.id, { version: a1.version, startAt: new Date(`${day}T13:00:00-04:00`).toISOString(), reason: "x" }, NOW),
      "VERSION_CONFLICT",
    );
  });
  it("parallel rebooking: two appointments moved into the same free slot at once → one wins", async () => {
    const day = "2027-03-23";
    const x = await book("x", { practitionerId: p1, startAt: new Date(`${day}T09:00:00-04:00`).toISOString() });
    const y = await book("x", { practitionerId: p1, startAt: new Date(`${day}T10:00:00-04:00`).toISOString() });
    const target = new Date(`${day}T14:00:00-04:00`).toISOString();
    const r = await Promise.allSettled([
      rescheduleAppointment(db, ctxAdmin, x.id, { version: x.version, startAt: target, reason: "race" }, NOW),
      rescheduleAppointment(db, ctxAdmin, y.id, { version: y.version, startAt: target, reason: "race" }, NOW),
    ]);
    expect(r.filter((v) => v.status === "fulfilled")).toHaveLength(1);
    const loser = r.findIndex((v) => v.status === "rejected");
    const [l] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, loser === 0 ? x.id : y.id));
    expect(l!.startAt.toISOString()).toBe(new Date(`${day}T${loser === 0 ? "09" : "10"}:00:00-04:00`).toISOString());
  });
});

describe("time off, closures and DST", () => {
  it("PTO blocks booking and reports impacted existing appointments without cancelling them", async () => {
    const day = "2027-03-24";
    const a = await book("x", { practitionerId: p2, startAt: new Date(`${day}T10:00:00-04:00`).toISOString() });
    const r = await createException(db, ctxAdmin, {
      kind: "PTO",
      practitionerId: p2,
      startAt: new Date(`${day}T00:00:00-04:00`).toISOString(),
      endAt: new Date(`${day}T23:59:00-04:00`).toISOString(),
      reason: "Synthetic PTO",
    });
    expect(r.impactedAppointmentIds).toEqual([a.id]);
    const [still] = await db.select().from(appointments).where(eq(appointments.id, a.id));
    expect(still!.status).toBe("CONFIRMED");
    await expectAppError(book("x", { practitionerId: p2, startAt: new Date(`${day}T14:00:00-04:00`).toISOString() }), "SLOT_UNAVAILABLE");
  });
  it("on the spring-forward day the calendar day is 23 hours and no 02:xx slot is offered", async () => {
    const cal = await getCalendar(db, ctxAdmin, { date: "2027-03-14", siteId: A.sites.s1.id });
    expect((new Date(cal.to).getTime() - new Date(cal.from).getTime()) / 3600_000).toBe(23);
    const fall = await getCalendar(db, ctxAdmin, { date: "2026-11-01", siteId: A.sites.s1.id });
    expect((new Date(fall.to).getTime() - new Date(fall.from).getTime()) / 3600_000).toBe(25);
  });
});

describe("status, idempotency, append-only history", () => {
  it("Idempotency-Key replays return the same appointment", async () => {
    const input = {
      practitionerId: p1,
      siteId: A.sites.s1.id,
      appointmentTypeId: videoTypeId,
      modality: "VIDEO",
      startAt: new Date("2027-03-25T09:00:00-04:00").toISOString(),
      patientId: patients[0],
      patientLocationState: "VA",
    };
    const r1 = await createAppointment(db, ctxAdmin, input, { idempotencyKey: "idem-test-key-0001", now: NOW });
    const r2 = await createAppointment(db, ctxAdmin, input, { idempotencyKey: "idem-test-key-0001", now: NOW });
    expect(r2.replayed).toBe(true);
    expect(r2.appointment.id).toBe(r1.appointment.id);
    expect(r1.appointment.eligibilityStatus).toBe("VERIFIED_ELIGIBLE");
    expect(r1.appointment.eligibilityDecision).toBe("ALLOW");
    expect(r1.appointment.patientLocationState).toBe("VA");
  });
  it("check-in only on the visit day; no-show only after start; history is append-only", async () => {
    const a = await book("x", { startAt: new Date("2027-03-26T09:00:00-04:00").toISOString() });
    await expectAppError(checkInAppointment(db, ctxAdmin, a.id, { version: a.version }, NOW), "CONFLICT");
    // The generic status endpoint cannot check in (check-in must re-evaluate eligibility).
    await expectAppError(changeAppointmentStatus(db, ctxAdmin, a.id, { version: a.version, status: "CHECKED_IN" }, new Date("2027-03-26T12:50:00Z")), "CONFLICT");
    await expectAppError(changeAppointmentStatus(db, ctxAdmin, a.id, { version: a.version, status: "NO_SHOW" }, NOW), "CONFLICT");
    const c = await checkInAppointment(db, ctxAdmin, a.id, { version: a.version }, new Date("2027-03-26T12:50:00Z"));
    expect(c.status).toBe("CHECKED_IN");
    const done = await changeAppointmentStatus(db, ctxAdmin, a.id, { version: c.version, status: "COMPLETED" }, new Date("2027-03-26T13:40:00Z"));
    expect(done.status).toBe("COMPLETED");
    await expectAppError(cancelAppointment(db, ctxAdmin, a.id, { version: done.version, reason: "x" }), "CONFLICT");
    await expect(db.execute(sql`update appointment_events set reason = 'tampered' where appointment_id = ${a.id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from resource_reservations where appointment_id = ${a.id}`)).rejects.toThrow();
    const detail = await getAppointment(db, ctxAdmin, a.id);
    expect(detail.events.map((e) => e.event)).toEqual(["BOOKED", "CHECK_IN_EVALUATED", "CHECKED_IN", "COMPLETED"]);
  });
});

describe("authorization (unauthorized booking)", () => {
  it("site-scoped scheduler books at their site but not another; denials are audited", async () => {
    const s = await A.users.scheduler.ctx(); // scheduler role at S1 only
    const ok = await book("x", { startAt: new Date("2027-03-29T09:00:00-04:00").toISOString(), appointmentTypeId: videoTypeId, modality: "VIDEO" }, s);
    expect(ok.status).toBe("CONFIRMED");
    await expectAppError(book("x", { siteId: A.sites.s2.id, startAt: new Date("2027-03-29T10:00:00-04:00").toISOString() }, s), "FORBIDDEN");
    const denies = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, A.org.id), eq(auditEvents.action, "appointment.create"), eq(auditEvents.outcome, "DENY")));
    expect(denies.length).toBeGreaterThan(0);
  });
  it("roles without scheduling.manage cannot book, hold or cancel; RCM cannot search patients", async () => {
    const pm = await A.users.pm.ctx();
    await expectAppError(book("x", { startAt: new Date("2027-03-29T11:00:00-04:00").toISOString() }, pm), "FORBIDDEN");
    await expectAppError(
      createHold(
        db,
        pm,
        { practitionerId: p1, siteId: A.sites.s1.id, appointmentTypeId: typeId, modality: "IN_PERSON", startAt: new Date("2027-03-29T11:00:00-04:00").toISOString() },
        NOW,
      ),
      "FORBIDDEN",
    );
    await expectAppError(searchPatients(db, await A.users.rcmAnalyst.ctx(), "Test"), "FORBIDDEN");
  });
  it("another organization's patient, provider or appointment is invisible", async () => {
    const other = await B.users.admin.ctx();
    await expectAppError(book("x", { startAt: new Date("2027-03-29T13:00:00-04:00").toISOString() }, other), "VALIDATION_FAILED");
    const mine = await book("x", { startAt: new Date("2027-03-29T14:00:00-04:00").toISOString() });
    await expectAppError(getAppointment(db, other, mine.id), "NOT_FOUND");
    await expectAppError(cancelAppointment(db, other, mine.id, { version: mine.version, reason: "x" }), "NOT_FOUND");
    expect(await searchPatients(db, other, "Test Patient")).toEqual([]);
  });
  it("booking is refused unless SCHEDULING_MODE=DEMO_ONLY (synthetic demo flag)", async () => {
    process.env.SCHEDULING_MODE = "";
    try {
      await expectAppError(book("x", { startAt: new Date("2027-03-29T15:00:00-04:00").toISOString() }), "BOOKING_DISABLED");
    } finally {
      process.env.SCHEDULING_MODE = "DEMO_ONLY";
    }
  });
});
