import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { appointmentEvents, appointments, auditEvents, eligibilityEvaluations, jobs, sites, tasks, waitlistEntries, waitlistOffers } from "@projectos/db/schema";
import { makeOrg, testDb, expectAppError, type Fixture } from "../../core/test/helpers";
import {
  changeAuthorityStatus,
  createEnrollment,
  createPayer,
  createPlan,
  createPractitioner,
  createRuleDraft,
  approveRule,
  updateEnrollment,
  verifyEnrollment,
} from "@projectos/credentialing";
import {
  acceptWaitlistOffer,
  changeAppointmentLocation,
  checkInAppointment,
  confirmPendingAppointment,
  createAppointment,
  createAppointmentType,
  createHold,
  createPatient,
  createTemplate,
  createWaitlistEntry,
  expireWaitlistOffers,
  explainEligibility,
  getAppointment,
  matchingSlots,
  offerWaitlistSlot,
  recheckAppointment,
  releaseExpiredHolds,
  rescheduleAppointment,
  rescreenUpcoming,
  searchSlots,
} from "../src";
import { eligibilityFixture } from "./fixtures";

/**
 * Phase 5 transaction tests against PostgreSQL. DEMO SYNTHETIC POLICY — NOT VERIFIED LAW.
 * Fixed clock (Mon 2027-03-08) — each test books on its own day so they never interfere.
 */
const NOW = new Date("2027-03-08T12:00:00Z");
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-04:00`).toISOString();

const { db, end } = testDb();
let A: Fixture;
let admin: Awaited<ReturnType<Fixture["users"]["admin"]["ctx"]>>;
let fx: Awaited<ReturnType<typeof eligibilityFixture>>;
let doc: string; // physician, VA license; MD license added in some tests
let doc2: string; // physician, VA license only
let video: string;
const pts: string[] = [];
let pi = 0;

beforeAll(async () => {
  process.env.SCHEDULING_MODE = "DEMO_ONLY";
  A = await makeOrg(db, "EL");
  admin = await A.users.admin.ctx();
  const mk = async (name: string) =>
    (
      await createPractitioner(db, admin, {
        displayName: `${name} (SYNTHETIC)`,
        profession: "PHYSICIAN",
        physicalState: "VA",
        telehealthCapable: true,
        siteIds: [A.sites.s1.id, A.sites.s2.id],
        specialtyIds: [],
        serviceIds: [],
        languages: [],
      })
    ).id;
  doc = await mk("Doc Eligible");
  doc2 = await mk("Doc VA Only");
  video = (await createAppointmentType(db, admin, { code: "V30", name: "Video 30", durationMinutes: 30, modalities: ["VIDEO"] }))!.id;
  for (const p of [doc, doc2])
    for (const site of [A.sites.s1.id, A.sites.s2.id])
      for (const weekday of [1, 2, 3, 4, 5])
        await createTemplate(db, admin, {
          practitionerId: p,
          siteId: site,
          weekday,
          startTime: site === A.sites.s1.id ? "09:00" : "13:00",
          endTime: site === A.sites.s1.id ? "12:00" : "17:00",
          modalities: ["IN_PERSON", "VIDEO"],
          effectiveFrom: "2027-01-01",
        });
  fx = await eligibilityFixture(db, A);
  for (const m of ["IN_PERSON", "VIDEO"]) {
    await fx.rule("VA", m);
    await fx.rule("MD", m);
  }
  await fx.license(doc, "VA");
  await fx.license(doc2, "VA");
  for (let i = 0; i < 8; i++) pts.push((await createPatient(db, admin, { displayName: `Elig Patient ${i}`, homeState: "VA" }))!.id);
});
afterAll(async () => end());

const book = (date: string, hhmm: string, o: Record<string, unknown> = {}, now = NOW) =>
  createAppointment(
    db,
    admin,
    {
      practitionerId: doc,
      siteId: A.sites.s1.id,
      appointmentTypeId: video,
      modality: "VIDEO",
      startAt: at(date, hhmm),
      patientId: pts[pi++ % pts.length],
      patientLocationState: "VA",
      ...o,
    },
    { now },
  );
const evals = (appointmentId: string) =>
  db.select().from(eligibilityEvaluations).where(eq(eligibilityEvaluations.appointmentId, appointmentId)).orderBy(asc(eligibilityEvaluations.evaluatedAt));

describe("fixture A: eligible booking persists an immutable evaluation", () => {
  it("ALLOW → CONFIRMED with evaluation, evidence and DEMO rule version; evaluations cannot be edited", async () => {
    const r = await book("2027-03-15", "09:00");
    expect(r.appointment).toMatchObject({ status: "CONFIRMED", eligibilityDecision: "ALLOW", eligibilityStatus: "VERIFIED_ELIGIBLE" });
    const [e] = await evals(r.appointment.id);
    expect(e).toMatchObject({ trigger: "BOOK", decision: "ALLOW", canConfirm: true, jurisdiction: "VA", isDemoPolicy: true, policyVersion: "VA-PHYSICIAN-VIDEO v1" });
    expect(e!.evidenceIds).toHaveLength(1);
    expect(r.appointment.eligibilityEvaluationId).toBe(e!.id);
    await expect(db.execute(sql`update eligibility_evaluations set decision = 'BLOCK' where id = ${e!.id}`)).rejects.toThrow();
    const detail = await getAppointment(db, admin, r.appointment.id);
    expect(detail.eligibility).toMatchObject({ decision: "ALLOW", stale: false });
  });
});

describe("LIC-01/02/04: VA-only physician, patient physically in MD (IMLC claim does not help)", () => {
  it("refused with 409 ELIGIBILITY_REVIEW + eligible alternatives; attempt persisted, DENY audited, one follow-up task", async () => {
    const e = (await expectAppError(book("2027-03-16", "09:00", { practitionerId: doc2, patientLocationState: "MD" }), "ELIGIBILITY_REVIEW")) as {
      details: { code: string; field: string; message: string }[];
      message: string;
    };
    expect(e.message).toMatch(/^Needs verification — No PHYSICIAN authority accepted for MD/);
    expect(e.details.find((d) => d.code === "AUTHORITY_MISSING")?.field).toBe("LICENSE_REVIEW");
    // The VA-only doctor is not offered; nobody here has MD evidence yet, so no eligible alternative either.
    expect(e.details.some((d) => d.code === "ELIGIBLE_ALTERNATIVE" && d.field.startsWith(doc2))).toBe(false);
    const attempts = await db
      .select()
      .from(eligibilityEvaluations)
      .where(and(eq(eligibilityEvaluations.organizationId, A.org.id), eq(eligibilityEvaluations.trigger, "BOOK_ATTEMPT"), eq(eligibilityEvaluations.practitionerId, doc2)));
    expect(attempts.at(-1)).toMatchObject({ decision: "REVIEW", jurisdiction: "MD", missingEvidenceCodes: ["AUTHORITY_MISSING"] });
    const denies = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, A.org.id), eq(auditEvents.action, "appointment.create"), eq(auditEvents.outcome, "DENY")));
    expect(denies.some((d) => (d.metadata as { codes?: string[] }).codes?.includes("AUTHORITY_MISSING"))).toBe(true);
    // Retry → still one task for this provider/context/reason (idempotent).
    await expectAppError(book("2027-03-16", "09:30", { practitionerId: doc2, patientLocationState: "MD" }), "ELIGIBILITY_REVIEW");
    const t = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.organizationId, A.org.id), sql`${tasks.title} like ${"%AUTHORITY_MISSING%Doc VA Only%"}`));
    expect(t).toHaveLength(1);
    expect(t[0]!.title).not.toMatch(/Patient/);
    const none = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.organizationId, A.org.id), eq(appointments.practitionerId, doc2)));
    expect(none).toHaveLength(0);
  });
  it("saved as PENDING when staff explicitly accept review; confirm stays refused until MD evidence is verified, then confirms", async () => {
    const r = await book("2027-03-17", "09:00", { patientLocationState: "MD", acceptPendingReview: true });
    expect(r.appointment).toMatchObject({ status: "PENDING", eligibilityDecision: "REVIEW" });
    await expectAppError(confirmPendingAppointment(db, admin, r.appointment.id, { version: r.appointment.version }, NOW), "ELIGIBILITY_REVIEW");
    await fx.license(doc, "MD");
    const [cur] = await db.select().from(appointments).where(eq(appointments.id, r.appointment.id));
    const c = await confirmPendingAppointment(db, admin, r.appointment.id, { version: cur!.version }, NOW);
    expect(c).toMatchObject({ status: "CONFIRMED" });
    const ev = await db.select().from(appointmentEvents).where(eq(appointmentEvents.appointmentId, r.appointment.id));
    expect(ev.map((x) => x.event)).toContain("CONFIRMED");
  });
});

describe("fixture C / LIC-03: patient changes MD → DC at check-in", () => {
  it("booked eligible for MD; at check-in the patient is in DC (no approved DC rule) → stopped, PENDING, escalation task; MD again → checks in", async () => {
    const r = await book("2027-03-18", "09:00", { patientLocationState: "MD" }); // doc has MD license (added above)
    expect(r.appointment.status).toBe("CONFIRMED");
    const day = new Date("2027-03-18T12:45:00Z");
    await expectAppError(checkInAppointment(db, admin, r.appointment.id, { version: r.appointment.version }, day), "VALIDATION_FAILED"); // must confirm location
    await expectAppError(
      checkInAppointment(db, admin, r.appointment.id, { version: r.appointment.version, patientLocationState: "DC", locationConfirmed: true }, day),
      "ELIGIBILITY_REVIEW",
    );
    const [after] = await db.select().from(appointments).where(eq(appointments.id, r.appointment.id));
    expect(after).toMatchObject({ status: "PENDING", patientLocationState: "DC", patientLocationStatus: "VERIFIED", eligibilityDecision: "REVIEW" });
    const all = await evals(r.appointment.id);
    expect(all.map((x) => [x.trigger, x.decision, x.jurisdiction])).toEqual([
      ["BOOK", "ALLOW", "MD"],
      ["CHECK_IN", "REVIEW", "DC"],
    ]);
    const ev = await db.select().from(appointmentEvents).where(eq(appointmentEvents.appointmentId, r.appointment.id));
    expect(ev.map((x) => x.event)).toContain("LOCATION_CHANGED_AT_CHECK_IN");
    // Patient corrects location back to MD (verified) → re-check → still PENDING (never auto-confirmed) → staff confirm → check-in.
    const moved = await changeAppointmentLocation(
      db,
      admin,
      r.appointment.id,
      { version: after!.version, patientLocationState: "MD", patientLocationStatus: "VERIFIED", reason: "Patient corrected location" },
      day,
    );
    expect(moved.eligibility.decision).toBe("ALLOW");
    expect(moved.appointment.status).toBe("PENDING");
    const conf = await confirmPendingAppointment(db, admin, r.appointment.id, { version: moved.appointment.version }, day);
    const ci = await checkInAppointment(db, admin, r.appointment.id, { version: conf.version, patientLocationState: "MD", locationConfirmed: true }, day);
    expect(ci.status).toBe("CHECKED_IN");
  });
});

describe("LIC-08 / fixture G: authority suspended after booking → rescreen", () => {
  it("rescreen moves the booking to NEEDS_RESCHEDULE (system actor, audited); a second run changes nothing", async () => {
    const other = (
      await createPractitioner(db, admin, {
        displayName: "Doc Suspended (SYNTHETIC)",
        profession: "PHYSICIAN",
        physicalState: "VA",
        telehealthCapable: true,
        siteIds: [A.sites.s1.id],
        specialtyIds: [],
        serviceIds: [],
        languages: [],
      })
    ).id;
    for (const weekday of [1, 2, 3, 4, 5])
      await createTemplate(db, admin, {
        practitionerId: other,
        siteId: A.sites.s1.id,
        weekday,
        startTime: "09:00",
        endTime: "12:00",
        modalities: ["VIDEO"],
        effectiveFrom: "2027-01-01",
      });
    const lic = await fx.license(other, "VA");
    const r = await book("2027-03-19", "09:00", { practitionerId: other });
    expect(r.appointment.status).toBe("CONFIRMED");
    await changeAuthorityStatus(db, await fx.approver.ctx(), lic.id, { version: lic.version, status: "SUSPENDED", note: "Synthetic board action" });
    const queued = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.type, "scheduling.rescreen"), sql`${jobs.payload}->>'practitionerId' = ${other}`));
    expect(queued).toHaveLength(2); // credentialing asked scheduling to rescreen (on verify and on suspend)
    const run1 = await rescreenUpcoming(db, { organizationId: A.org.id, practitionerId: other, now: NOW });
    expect(run1).toMatchObject({ changed: 1 });
    const [a] = await db.select().from(appointments).where(eq(appointments.id, r.appointment.id));
    expect(a).toMatchObject({ status: "NEEDS_RESCHEDULE", eligibilityDecision: "BLOCK" });
    const ev = await db
      .select()
      .from(appointmentEvents)
      .where(and(eq(appointmentEvents.appointmentId, a!.id), eq(appointmentEvents.event, "ELIGIBILITY_CHANGED")));
    expect(ev[0]!.actorSystem).toBe("scheduling.rescreen");
    expect((await rescreenUpcoming(db, { organizationId: A.org.id, practitionerId: other, now: NOW })).changed).toBe(0);
    // And a new booking is refused outright.
    await expectAppError(book("2027-03-19", "10:00", { practitionerId: other }), "ELIGIBILITY_BLOCKED");
  });
});

describe("LIC-10 / fixture F: payer enrollment is site-specific", () => {
  it("plan approved+verified at site 1 only → video booked at site 2 with that plan BLOCK; self-pay at site 2 → ALLOW", async () => {
    const spec = await fx.spec.ctx();
    const payer = (await createPayer(db, spec, { code: "TPAY", name: "Test Payer (SYNTHETIC)" }))!;
    const plan = (await createPlan(db, spec, { payerId: payer.id, code: "TP1", name: "Test Plan 1", requiresEnrollment: true }))!;
    const enr = (await createEnrollment(db, spec, { practitionerId: doc, payerPlanId: plan.id, siteId: A.sites.s1.id, status: "SUBMITTED", submittedOn: "2026-09-01" }))!;
    const ap = await updateEnrollment(db, spec, enr.id, {
      version: enr.version,
      status: "APPROVED",
      submittedOn: "2026-09-01",
      approvedOn: "2026-10-01",
      effectiveOn: "2026-09-15",
    });
    await verifyEnrollment(db, await fx.approver.ctx(), enr.id, { version: ap.version, sourceName: "Synthetic letter" });
    const ok1 = await book("2027-03-22", "09:00", { payerPlanId: plan.id });
    expect(ok1.appointment.status).toBe("CONFIRMED");
    const e = (await expectAppError(book("2027-03-22", "13:00", { siteId: A.sites.s2.id, payerPlanId: plan.id }), "ELIGIBILITY_BLOCKED")) as {
      details: { code: string; field: string }[];
    };
    expect(e.details.find((d) => d.code === "PAYER_NOT_ENROLLED")?.field).toBe("PAYER_NOT_READY");
    const self = await book("2027-03-22", "13:00", { siteId: A.sites.s2.id });
    expect(self.eligibility!.licenseStatus).toBe("VERIFIED_ELIGIBLE");
    expect(self.appointment.status).toBe("CONFIRMED");
  });
});

describe("fixture J / K: EHR source of truth and unknown location", () => {
  it("video with no patient location → REVIEW LOCATION_UNKNOWN (hold still allowed, booking not confirmed)", async () => {
    const h = await createHold(db, admin, { practitionerId: doc, siteId: A.sites.s1.id, appointmentTypeId: video, modality: "VIDEO", startAt: at("2027-03-23", "09:00") }, NOW);
    expect(h.eligibility.decision).toBe("REVIEW");
    const e = (await expectAppError(book("2027-03-23", "09:00", { holdId: h.id, patientLocationState: null }), "ELIGIBILITY_REVIEW")) as { details: { code: string }[] };
    expect(e.details.map((d) => d.code)).toContain("LOCATION_UNKNOWN");
  });
  it("site whose master schedule is a stale EHR → REVIEW EHR_STALE; read-only site → BLOCK", async () => {
    await db
      .update(sites)
      .set({ ehrSyncMode: "EHR_MASTER", ehrLastSyncedAt: new Date(NOW.getTime() - 5 * 3600_000) })
      .where(eq(sites.id, A.sites.s2.id));
    try {
      const e = (await expectAppError(book("2027-03-23", "13:00", { siteId: A.sites.s2.id }), "ELIGIBILITY_REVIEW")) as { details: { code: string }[] };
      expect(e.details.map((d) => d.code)).toEqual(["EHR_STALE"]);
      const pending = await book("2027-03-23", "13:00", { siteId: A.sites.s2.id, acceptPendingReview: true });
      expect(pending.appointment.status).toBe("PENDING"); // queued as draft for staff review
      await db.update(sites).set({ ehrSyncMode: "READ_ONLY" }).where(eq(sites.id, A.sites.s2.id));
      await expectAppError(book("2027-03-23", "14:00", { siteId: A.sites.s2.id }), "ELIGIBILITY_BLOCKED");
    } finally {
      await db.update(sites).set({ ehrSyncMode: "DEMO", ehrLastSyncedAt: null }).where(eq(sites.id, A.sites.s2.id));
    }
  });
});

describe("reschedule re-evaluates; failure leaves the original intact", () => {
  it("move to a date after the license expires → BLOCK, original unchanged", async () => {
    const short = (
      await createPractitioner(db, admin, {
        displayName: "Doc Expiring (SYNTHETIC)",
        profession: "PHYSICIAN",
        physicalState: "VA",
        telehealthCapable: true,
        siteIds: [A.sites.s1.id],
        specialtyIds: [],
        serviceIds: [],
        languages: [],
      })
    ).id;
    for (const weekday of [1, 2, 3, 4, 5])
      await createTemplate(db, admin, {
        practitionerId: short,
        siteId: A.sites.s1.id,
        weekday,
        startTime: "09:00",
        endTime: "12:00",
        modalities: ["VIDEO"],
        effectiveFrom: "2027-01-01",
      });
    await fx.license(short, "VA", { expiresOn: "2027-03-31" });
    const r = await book("2027-03-24", "09:00", { practitionerId: short });
    await expectAppError(
      rescheduleAppointment(db, admin, r.appointment.id, { version: r.appointment.version, startAt: at("2027-04-01", "09:00"), reason: "move" }, NOW),
      "ELIGIBILITY_BLOCKED",
    );
    const [same] = await db.select().from(appointments).where(eq(appointments.id, r.appointment.id));
    expect(same!.startAt.toISOString()).toBe(new Date(at("2027-03-24", "09:00")).toISOString());
    expect(same!.version).toBe(r.appointment.version);
    const attempt = (await evals(r.appointment.id)).find((x) => x.trigger === "RESCHEDULE_ATTEMPT");
    expect(attempt).toMatchObject({ decision: "BLOCK" });
    const moved = await rescheduleAppointment(db, admin, r.appointment.id, { version: r.appointment.version, startAt: at("2027-03-25", "09:00"), reason: "ok" }, NOW);
    expect(moved.status).toBe("CONFIRMED");
  });
});

describe("one decision everywhere (search, explain, booking)", () => {
  it("search slot, explain endpoint and booking derive the same decision and policy version", async () => {
    const s = await searchSlots(
      db,
      admin,
      { appointmentTypeId: video, modality: "VIDEO", siteId: A.sites.s1.id, practitionerId: doc2, fromDate: "2027-03-26", days: 1, patientState: "MD", show: "all" },
      NOW,
    );
    const slot = s.slots[0]!;
    expect(slot.eligibility.decision).toBe("REVIEW");
    const ex = await explainEligibility(
      db,
      admin,
      { practitionerId: doc2, siteId: A.sites.s1.id, appointmentTypeId: video, modality: "VIDEO", startAt: slot.startAt, patientLocationState: "MD" },
      NOW,
    );
    expect(ex.decision).toBe(slot.eligibility.decision);
    expect(ex.summary).toBe(slot.eligibility.summary);
    // Default search hides it and explains why instead.
    const def = await searchSlots(
      db,
      admin,
      { appointmentTypeId: video, modality: "VIDEO", siteId: A.sites.s1.id, practitionerId: doc2, fromDate: "2027-03-26", days: 1, patientState: "MD" },
      NOW,
    );
    expect(def.slots).toHaveLength(0);
    expect(def.notOffered[0]).toMatchObject({ practitionerId: doc2, decision: "REVIEW", categories: ["LICENSE_REVIEW"] });
  });
  it("a persisted evaluation past its TTL is reported stale; a re-check persists a fresh one", async () => {
    const r = await book("2027-03-26", "10:00");
    const [old] = await evals(r.appointment.id);
    await db.execute(sql`alter table eligibility_evaluations disable trigger eligibility_evaluations_no_update`);
    await db.execute(sql`update eligibility_evaluations set expires_at = now() - interval '1 minute' where id = ${old!.id}`);
    await db.execute(sql`alter table eligibility_evaluations enable trigger eligibility_evaluations_no_update`);
    expect((await getAppointment(db, admin, r.appointment.id)).eligibility!.stale).toBe(true);
    const re = await recheckAppointment(db, admin, r.appointment.id, new Date());
    expect(re.eligibility.decision).toBe("ALLOW");
    expect((await getAppointment(db, admin, r.appointment.id)).eligibility!.stale).toBe(false);
  });
});

describe("waitlist offers with expiry and re-evaluation", () => {
  const entry = (o: Record<string, unknown> = {}) =>
    createWaitlistEntry(db, admin, {
      patientId: pts[7],
      appointmentTypeId: video,
      modality: "VIDEO",
      patientLocationState: "VA",
      earliestDate: "2027-03-29",
      latestDate: "2027-04-02",
      weekdays: [2, 3],
      afterTime: "10:00",
      priority: 1,
      ...o,
    });
  it("matches only eligible times in the window; offer holds the time; accept books it", async () => {
    const e = await entry();
    const m = await matchingSlots(db, admin, e.id, NOW);
    expect(m.length).toBeGreaterThan(0);
    expect(m.every((s) => ["2027-03-30", "2027-03-31"].includes(s.date) && s.localStart >= "10:00" && s.eligibility.decision === "ALLOW")).toBe(true);
    const offer = await offerWaitlistSlot(db, admin, e.id, {}, NOW);
    expect(offer.status).toBe("OFFERED");
    const [ev] = await db.select().from(eligibilityEvaluations).where(eq(eligibilityEvaluations.waitlistOfferId, offer.id));
    expect(ev!.decision).toBe("ALLOW");
    const appt = await acceptWaitlistOffer(db, admin, offer.id, NOW);
    expect(appt.status).toBe("CONFIRMED");
    const [done] = await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, e.id));
    expect(done).toMatchObject({ status: "BOOKED", appointmentId: appt.id });
  });
  it("an unanswered offer expires: hold released, offer EXPIRED, entry active again (idempotent)", async () => {
    const e = await entry({ weekdays: [3] });
    const offer = await offerWaitlistSlot(db, admin, e.id, { expiresInMinutes: 30 }, NOW);
    const later = new Date(NOW.getTime() + 31 * 60_000);
    expect((await releaseExpiredHolds(db, { organizationId: A.org.id, now: later })).released).toBeGreaterThanOrEqual(1);
    expect((await expireWaitlistOffers(db, later)).expired).toBeGreaterThanOrEqual(1);
    expect((await expireWaitlistOffers(db, later)).expired).toBe(0);
    const [o] = await db.select().from(waitlistOffers).where(eq(waitlistOffers.id, offer.id));
    expect(o!.status).toBe("EXPIRED");
    const [en] = await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, e.id));
    expect(en!.status).toBe("ACTIVE");
    await expectAppError(acceptWaitlistOffer(db, admin, offer.id, later), "CONFLICT");
  });
  it("eligibility lost between offer and accept → offer INVALIDATED, nothing booked, entry active", async () => {
    const e = await entry({ practitionerId: doc, weekdays: [2], patientLocationState: "MD" });
    const offer = await offerWaitlistSlot(db, admin, e.id, {}, NOW);
    // Compliance retires the MD video rule (and its rescreen job is queued).
    const mdRules = await db.execute<{ id: string }>(
      sql`select id from license_policy_rules where organization_id = ${A.org.id} and rule_key = 'MD-PHYSICIAN-VIDEO' and status = 'APPROVED'`,
    );
    const { retireRule } = await import("@projectos/credentialing");
    await retireRule(db, await fx.compliance.ctx(), [...mdRules][0]!.id, { reason: "Test: policy withdrawn" });
    await expectAppError(acceptWaitlistOffer(db, admin, offer.id, NOW), "ELIGIBILITY_REVIEW");
    const [o] = await db.select().from(waitlistOffers).where(eq(waitlistOffers.id, offer.id));
    expect(o!.status).toBe("INVALIDATED");
    const [en] = await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, e.id));
    expect(en!.status).toBe("ACTIVE");
    // Re-approve a new version for later tests.
    const d = await createRuleDraft(db, await fx.spec.ctx(), {
      jurisdiction: "MD",
      profession: "PHYSICIAN",
      modality: "VIDEO",
      authorizationBasis: ["STATE_LICENSE"],
      effectiveFrom: "2026-01-01",
      nextReviewOn: "2028-01-01",
      sourceSummary: "DEMO SYNTHETIC POLICY — NOT VERIFIED LAW",
      isDemo: true,
    });
    await approveRule(db, await fx.compliance.ctx(), d.id, { reason: "Test" });
  });
});

describe("policy publication permission + audit (SEC-02)", () => {
  it("a scheduler cannot publish policy (403 + DENY audit); a compliance approval is audited and queues a rescreen", async () => {
    const d = await createRuleDraft(db, await fx.spec.ctx(), {
      jurisdiction: "DC",
      profession: "PHYSICIAN",
      modality: "VIDEO",
      authorizationBasis: ["STATE_LICENSE"],
      effectiveFrom: "2026-01-01",
      nextReviewOn: "2028-01-01",
      sourceSummary: "DEMO SYNTHETIC POLICY — NOT VERIFIED LAW",
      isDemo: true,
    });
    await expectAppError(approveRule(db, await A.users.scheduler.ctx(), d.id, { reason: "nope" }), "FORBIDDEN");
    const deny = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.resourceId, d.id), eq(auditEvents.action, "rule.approve"), eq(auditEvents.outcome, "DENY")));
    expect(deny).toHaveLength(1);
    await approveRule(db, await fx.compliance.ctx(), d.id, { reason: "Test fixture" });
    const allow = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.resourceId, d.id), eq(auditEvents.action, "rule.approve"), eq(auditEvents.outcome, "ALLOW")));
    expect(allow).toHaveLength(1);
    const q = await db
      .select()
      .from(jobs)
      .where(eq(jobs.idempotencyKey, `rescreen:rule:${d.id}:approved`));
    expect(q).toHaveLength(1);
  });
});

describe("fixture I: two schedulers race for one eligible slot", () => {
  it("both pass eligibility, the DB lets exactly one book", async () => {
    const r = await Promise.allSettled([book("2027-03-31", "11:00"), book("2027-03-31", "11:00")]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.code).toBe("SLOT_CONFLICT");
  });
});
