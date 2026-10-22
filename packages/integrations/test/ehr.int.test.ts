import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  appointmentEvents,
  appointments,
  ehrAppointmentLinks,
  ehrConnections,
  ehrSimAppointments,
  integrationConflicts,
  outboxEvents,
  patients,
  scheduleExceptions,
  sites,
} from "@projectos/db/schema";
import { makeOrg, testDb, expectAppError, type Fixture } from "../../core/test/helpers";
import { createPractitioner } from "@projectos/credentialing";
import { dispatchOutbox } from "@projectos/notifications";
import {
  cancelAppointment,
  confirmPendingAppointment,
  createAppointment,
  createAppointmentType,
  createPatient,
  createTemplate,
  rescheduleAppointment,
  searchSlots,
} from "@projectos/scheduling";
import { eligibilityFixture } from "../../scheduling/test/fixtures";
import {
  connectSimulator,
  getIntegrationHealth,
  pullEhrChanges,
  reconcileConnection,
  resolveConflict,
  runHealthCheck,
  setSimFailureMode,
  setSimulatorFailureMode,
  simulateEhrSideBooking,
  simulateEhrSideChange,
  simulateEhrSideDeletion,
  syncAvailability,
  UnverifiedVendorAdapter,
  connectionLabel,
} from "../src";

/**
 * Phase 7: EHR_MASTER write-through against the SYNTHETIC simulator. Fixed clock; each test books its own day.
 * EHR-01 (authoritative EHR down → no local confirmation) and EHR-02 (retry → exactly one external appointment).
 */
const NOW = new Date("2027-04-05T12:00:00Z"); // Monday
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-04:00`).toISOString();

const { db, end } = testDb();
let A: Fixture;
let admin: Awaited<ReturnType<Fixture["users"]["admin"]["ctx"]>>;
let doc: string;
let visit: string;
let conn: Awaited<ReturnType<typeof connectSimulator>>;
const pts: { id: string; mrn: string }[] = [];
let pi = 0;
const flush = () => dispatchOutbox(db, { limit: 500, types: ["ehr.write"] });
const appt = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0]!;
const book = (date: string, hhmm: string, o: Record<string, unknown> = {}) =>
  createAppointment(
    db,
    admin,
    {
      practitionerId: doc,
      siteId: A.sites.s1.id,
      appointmentTypeId: visit,
      modality: "IN_PERSON",
      startAt: at(date, hhmm),
      patientId: pts[pi++ % 6]!.id,
      patientLocationState: "VA",
      ...o,
    },
    { now: NOW },
  );
const freshConn = async () => (await db.select().from(ehrConnections).where(eq(ehrConnections.id, conn.id)))[0]!;
const sync = async () => {
  await runHealthCheck(db, await freshConn());
  return syncAvailability(db, await freshConn(), NOW);
};

beforeAll(async () => {
  process.env.SCHEDULING_MODE = "DEMO_ONLY";
  A = await makeOrg(db, "EH");
  admin = await A.users.admin.ctx();
  doc = (
    await createPractitioner(db, admin, {
      displayName: "Doc EHR (SYNTHETIC)",
      profession: "PHYSICIAN",
      physicalState: "VA",
      siteIds: [A.sites.s1.id],
      specialtyIds: [],
      serviceIds: [],
      languages: [],
    })
  ).id;
  visit = (await createAppointmentType(db, admin, { code: "IP30", name: "In person 30", durationMinutes: 30, modalities: ["IN_PERSON"] }))!.id;
  for (const weekday of [1, 2, 3, 4, 5])
    await createTemplate(db, admin, {
      practitionerId: doc,
      siteId: A.sites.s1.id,
      weekday,
      startTime: "09:00",
      endTime: "17:00",
      modalities: ["IN_PERSON"],
      effectiveFrom: "2027-01-01",
    });
  const fx = await eligibilityFixture(db, A);
  await fx.rule("VA", "IN_PERSON");
  await fx.license(doc, "VA");
  for (let i = 0; i < 8; i++) {
    const p = (await createPatient(db, admin, { displayName: `EHR Patient ${i}`, homeState: "VA" }))!;
    const [row] = await db.select({ mrn: patients.mrn }).from(patients).where(eq(patients.id, p.id));
    pts.push({ id: p.id, mrn: row!.mrn });
  }
  // Patient 6 is missing in the EHR, patient 7 has two EHR records (ambiguous).
  conn = await connectSimulator(db, admin, A.sites.s1.id, { missingMrns: [pts[6]!.mrn], duplicateMrns: [pts[7]!.mrn] });
  await db.update(sites).set({ ehrSyncMode: "EHR_MASTER", ehrFreshnessMinutes: 60 }).where(eq(sites.id, A.sites.s1.id));
  await sync();
});
afterAll(async () => end());

describe("EHR_MASTER write-through", () => {
  it("booking is PENDING (not confirmed) until the EHR accepts it, then CONFIRMED + mapped", async () => {
    const r = await book("2027-04-06", "09:00");
    expect(r.appointment).toMatchObject({ status: "PENDING", ehrState: "PENDING_CREATE", eligibilityDecision: "ALLOW" });
    // The DB itself refuses a local confirmation before the EHR accepted it.
    await expect(db.execute(sql`update appointments set status = 'CONFIRMED' where id = ${r.appointment.id}`)).rejects.toThrow();
    await flush();
    const a = await appt(r.appointment.id);
    expect(a).toMatchObject({ status: "CONFIRMED", ehrState: "SYNCED" });
    const links = await db.select().from(ehrAppointmentLinks).where(eq(ehrAppointmentLinks.appointmentId, a.id));
    expect(links).toHaveLength(1);
    const [remote] = await db.select().from(ehrSimAppointments).where(eq(ehrSimAppointments.externalId, links[0]!.externalId));
    expect(remote).toMatchObject({ status: "booked", origin: "PROJECTOS" });
    expect(remote!.startAt.toISOString()).toBe(a.startAt.toISOString());
    const evs = await db.select().from(appointmentEvents).where(eq(appointmentEvents.appointmentId, a.id)).orderBy(asc(appointmentEvents.at));
    expect(evs.map((e) => e.event)).toEqual(["BOOKED", "EHR_CONFIRMED"]);
  });

  it("EHR-01: authoritative EHR unreachable → booking is only a draft; confirming returns 503; nothing confirmed", async () => {
    await setSimulatorFailureMode(db, admin, conn.id, { failureMode: "UNREACHABLE" });
    const stop = (await expectAppError(book("2027-04-07", "09:00"), "ELIGIBILITY_REVIEW")) as { details: { code: string }[] };
    expect(stop.details.some((d) => d.code === "EHR_UNAVAILABLE")).toBe(true);
    const draft = await book("2027-04-07", "09:00", { acceptPendingReview: true });
    expect(draft.appointment).toMatchObject({ status: "PENDING", ehrState: "DRAFT" });
    await expectAppError(confirmPendingAppointment(db, admin, draft.appointment.id, { version: draft.appointment.version }, NOW), "SERVICE_UNAVAILABLE");
    expect(await appt(draft.appointment.id)).toMatchObject({ status: "PENDING", ehrState: "DRAFT" });
    // Back online: confirm sends it; the EHR accepts; only then CONFIRMED.
    await setSimulatorFailureMode(db, admin, conn.id, { failureMode: "NONE" });
    const sent = await confirmPendingAppointment(db, admin, draft.appointment.id, { version: draft.appointment.version }, NOW); // the 503 rolled back: version unchanged
    expect(sent).toMatchObject({ status: "PENDING", ehrState: "PENDING_CREATE" });
    await flush();
    expect(await appt(draft.appointment.id)).toMatchObject({ status: "CONFIRMED", ehrState: "SYNCED" });
  });

  it("stale master schedule (sync older than the limit) → fail closed (review/draft only)", async () => {
    await db
      .update(sites)
      .set({ ehrLastSyncedAt: new Date(NOW.getTime() - 3 * 3600_000) })
      .where(eq(sites.id, A.sites.s1.id));
    const stop = (await expectAppError(book("2027-04-08", "09:00"), "ELIGIBILITY_REVIEW")) as { details: { code: string }[] };
    expect(stop.details.some((d) => d.code === "EHR_STALE")).toBe(true);
    await sync();
    const ok = await book("2027-04-08", "09:00");
    expect(ok.appointment.ehrState).toBe("PENDING_CREATE");
    await flush();
  });

  it("EHR-02: timeout after the EHR wrote → retry → exactly one external appointment and one mapping", async () => {
    await setSimFailureMode(db, conn.id, "TIMEOUT_AFTER_WRITE");
    const r = await book("2027-04-09", "10:00");
    await flush(); // the EHR wrote it but we never saw the answer
    let ev = (
      await db
        .select()
        .from(outboxEvents)
        .where(sql`${outboxEvents.payload}->>'appointmentId' = ${r.appointment.id}`)
    )[0]!;
    expect(ev.status).toBe("FAILED");
    expect(await appt(r.appointment.id)).toMatchObject({ status: "PENDING", ehrState: "PENDING_CREATE" });
    await setSimFailureMode(db, conn.id, "NONE");
    await db
      .update(outboxEvents)
      .set({ availableAt: new Date(Date.now() - 1000) })
      .where(eq(outboxEvents.id, ev.id));
    await flush();
    ev = (await db.select().from(outboxEvents).where(eq(outboxEvents.id, ev.id)))[0]!;
    expect(ev.status).toBe("DONE");
    const remote = await db
      .select()
      .from(ehrSimAppointments)
      .where(and(eq(ehrSimAppointments.connectionId, conn.id), eq(ehrSimAppointments.idempotencyKey, `projectos:appointment:${r.appointment.id}:create`)));
    expect(remote).toHaveLength(1);
    expect(await db.select().from(ehrAppointmentLinks).where(eq(ehrAppointmentLinks.appointmentId, r.appointment.id))).toHaveLength(1);
    expect(await appt(r.appointment.id)).toMatchObject({ status: "CONFIRMED", ehrState: "SYNCED" });
  });

  it("writes that keep failing go DEAD → booking FAILED (never confirmed) + visible conflict; Retry recovers", async () => {
    await setSimFailureMode(db, conn.id, "FAIL_WRITES");
    const r = await book("2027-04-12", "09:00");
    await db
      .update(outboxEvents)
      .set({ maxAttempts: 2 })
      .where(sql`${outboxEvents.payload}->>'appointmentId' = ${r.appointment.id}`);
    for (let i = 0; i < 2; i++) {
      await db
        .update(outboxEvents)
        .set({ availableAt: new Date(Date.now() - 1000) })
        .where(sql`${outboxEvents.payload}->>'appointmentId' = ${r.appointment.id}`);
      await flush();
    }
    expect(await appt(r.appointment.id)).toMatchObject({ status: "PENDING", ehrState: "FAILED" });
    const [c] = await db
      .select()
      .from(integrationConflicts)
      .where(and(eq(integrationConflicts.appointmentId, r.appointment.id), eq(integrationConflicts.status, "OPEN")));
    expect(c!.kind).toBe("WRITE_FAILED");
    await setSimFailureMode(db, conn.id, "NONE");
    await resolveConflict(db, admin, c!.id, { action: "RETRY" }, NOW);
    await flush();
    expect(await appt(r.appointment.id)).toMatchObject({ status: "CONFIRMED", ehrState: "SYNCED" });
  });

  it("patient identifier mapping: missing or ambiguous EHR patient → rejected immediately, never guessed", async () => {
    const missing = await book("2027-04-13", "09:00", { patientId: pts[6]!.id });
    const ambiguous = await book("2027-04-13", "10:00", { patientId: pts[7]!.id });
    await flush();
    expect(await appt(missing.appointment.id)).toMatchObject({ status: "PENDING", ehrState: "FAILED" });
    expect(await appt(ambiguous.appointment.id)).toMatchObject({ status: "PENDING", ehrState: "FAILED" });
    const kinds = await db
      .select({ kind: integrationConflicts.kind })
      .from(integrationConflicts)
      .where(and(eq(integrationConflicts.organizationId, A.org.id), sql`${integrationConflicts.kind} in ('PATIENT_NOT_FOUND','PATIENT_AMBIGUOUS')`));
    expect(kinds.map((k) => k.kind).sort()).toEqual(["PATIENT_AMBIGUOUS", "PATIENT_NOT_FOUND"]);
    const dead = await db
      .select()
      .from(outboxEvents)
      .where(sql`${outboxEvents.payload}->>'appointmentId' in (${missing.appointment.id}, ${ambiguous.appointment.id})`);
    expect(dead.every((d) => d.status === "DEAD" && d.attempts === 1)).toBe(true); // permanent → no pointless retries
  });

  it("reschedule and cancel are written to the EHR (update with ETag, then cancel)", async () => {
    const r = await book("2027-04-14", "09:00");
    await flush();
    let a = await appt(r.appointment.id);
    const moved = await rescheduleAppointment(db, admin, a.id, { version: a.version, startAt: at("2027-04-14", "11:00"), reason: "Patient asked (synthetic)" }, NOW);
    expect(moved).toMatchObject({ status: "PENDING", ehrState: "PENDING_UPDATE" });
    await flush();
    a = await appt(r.appointment.id);
    expect(a).toMatchObject({ status: "CONFIRMED", ehrState: "SYNCED" });
    const [link] = await db.select().from(ehrAppointmentLinks).where(eq(ehrAppointmentLinks.appointmentId, a.id));
    let [remote] = await db.select().from(ehrSimAppointments).where(eq(ehrSimAppointments.externalId, link!.externalId));
    expect(remote!.startAt.toISOString()).toBe(new Date(at("2027-04-14", "11:00")).toISOString());
    await cancelAppointment(db, admin, a.id, { version: a.version, reason: "No longer needed (synthetic)" }, NOW);
    expect((await appt(a.id)).ehrState).toBe("PENDING_CANCEL");
    await flush();
    [remote] = await db.select().from(ehrSimAppointments).where(eq(ehrSimAppointments.externalId, link!.externalId));
    expect(remote!.status).toBe("cancelled");
    expect((await appt(a.id)).ehrState).toBe("SYNCED");
  });
});

describe("availability sync, change feed and reconciliation", () => {
  it("time booked directly in the EHR is imported as busy and no longer offered; removal releases it", async () => {
    const loc = "loc-s1";
    const prac = `prac-${doc.slice(0, 8)}`;
    const start = new Date(at("2027-04-15", "09:00"));
    const ext = await simulateEhrSideBooking(db, conn.id, { practitionerExternalId: prac, locationExternalId: loc, start, end: new Date(start.getTime() + 60 * 60_000) });
    const s1 = await sync();
    expect(s1).toMatchObject({ ok: true });
    const blocks = await db
      .select()
      .from(scheduleExceptions)
      .where(eq(scheduleExceptions.externalRef, `${conn.id}:${ext}`));
    expect(blocks).toHaveLength(1);
    const slots = await searchSlots(
      db,
      admin,
      { appointmentTypeId: visit, modality: "IN_PERSON", siteId: A.sites.s1.id, practitionerId: doc, fromDate: "2027-04-15", days: 1, patientState: "VA", show: "all" },
      NOW,
    );
    const starts = (slots as unknown as { slots: { startAt: string }[] }).slots.map((s) => new Date(s.startAt).toISOString());
    expect(starts).not.toContain(start.toISOString());
    // Running the sync again changes nothing (idempotent).
    expect(await sync()).toMatchObject({ ok: true, imported: 0 });
    await simulateEhrSideChange(db, conn.id, ext, { cancel: true });
    await sync();
    const [after] = await db
      .select()
      .from(scheduleExceptions)
      .where(eq(scheduleExceptions.externalRef, `${conn.id}:${ext}`));
    expect(after!.cancelledAt).not.toBeNull();
  });

  it("EHR-side cancellation of our booking → NEEDS_RESCHEDULE + conflict; Accept EHR cancels locally without a second EHR cancel", async () => {
    const r = await book("2027-04-16", "09:00");
    await flush();
    const [link] = await db.select().from(ehrAppointmentLinks).where(eq(ehrAppointmentLinks.appointmentId, r.appointment.id));
    await simulateEhrSideChange(db, conn.id, link!.externalId, { cancel: true });
    const ch = await pullEhrChanges(db, await freshConn());
    expect(ch).toMatchObject({ ok: true });
    expect(await appt(r.appointment.id)).toMatchObject({ status: "NEEDS_RESCHEDULE", ehrState: "CONFLICT" });
    const [c] = await db
      .select()
      .from(integrationConflicts)
      .where(and(eq(integrationConflicts.appointmentId, r.appointment.id), eq(integrationConflicts.kind, "EXTERNAL_CANCELLED")));
    // Pulling again does not duplicate the conflict.
    await pullEhrChanges(db, await freshConn());
    expect(await db.select().from(integrationConflicts).where(eq(integrationConflicts.appointmentId, r.appointment.id))).toHaveLength(1);
    await resolveConflict(db, admin, c!.id, { action: "ACCEPT_EHR" }, NOW);
    expect(await appt(r.appointment.id)).toMatchObject({ status: "CANCELLED", ehrState: "SYNCED" });
    const extra = await db
      .select()
      .from(outboxEvents)
      .where(and(sql`${outboxEvents.payload}->>'appointmentId' = ${r.appointment.id}`, sql`${outboxEvents.payload}->>'op' = 'CANCEL'`));
    expect(extra).toHaveLength(0);
  });

  it("reconciliation finds a mapping whose EHR record vanished and a moved appointment; repeated runs don't duplicate", async () => {
    const gone = await book("2027-04-19", "09:00");
    const moved = await book("2027-04-19", "10:00");
    await flush();
    const linkOf = async (id: string) => (await db.select().from(ehrAppointmentLinks).where(eq(ehrAppointmentLinks.appointmentId, id)))[0]!;
    await simulateEhrSideDeletion(db, conn.id, (await linkOf(gone.appointment.id)).externalId);
    await simulateEhrSideChange(db, conn.id, (await linkOf(moved.appointment.id)).externalId, { moveMinutes: 60 });
    const r1 = await reconcileConnection(db, await freshConn(), NOW);
    expect(r1).toMatchObject({ ok: true, missing: 1, conflicts: 1 });
    const r2 = await reconcileConnection(db, await freshConn(), NOW);
    expect(r2).toMatchObject({ ok: true, missing: 1, conflicts: 0 });
    const open = await db
      .select({ kind: integrationConflicts.kind })
      .from(integrationConflicts)
      .where(and(sql`${integrationConflicts.appointmentId} in (${gone.appointment.id}, ${moved.appointment.id})`, eq(integrationConflicts.status, "OPEN")));
    expect(open.map((o) => o.kind).sort()).toEqual(["EXTERNAL_CHANGED", "MISSING_EXTERNAL"]);
  });

  it("Integration Health never claims an unverified vendor is connected; the simulator is labelled as such", async () => {
    expect(connectionLabel({ vendor: "UNVERIFIED_VENDOR", enabled: true, lastHealthOk: true, lastHealthAt: NOW }, NOW).text).toMatch(/^Not connected/);
    expect((await new UnverifiedVendorAdapter().health()).ok).toBe(false);
    await expect(new UnverifiedVendorAdapter().createAppointment()).rejects.toThrow(/not verified/);
    const h = await getIntegrationHealth(db, admin, new Date());
    const s1 = h.sites.find((s) => s.site.id === A.sites.s1.id)!;
    expect(s1.connection?.label.text).toMatch(/Synthetic simulator/);
    expect(s1.ehrStates.SYNCED).toBeGreaterThan(0);
    await expectAppError(getIntegrationHealth(db, await A.users.rcmAnalyst.ctx()), "FORBIDDEN");
    await expectAppError(setSimulatorFailureMode(db, await A.users.scheduler.ctx(), conn.id, { failureMode: "NONE" }), "FORBIDDEN");
  });
});
