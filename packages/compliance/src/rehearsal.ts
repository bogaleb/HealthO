import { and, eq, sql } from "drizzle-orm";
import { createDb, isMain, loadRootEnv, type Db } from "@projectos/db";
import { appointments, departments, ehrAppointmentLinks, ehrConnections, ehrSimAppointments, integrationConflicts, sites } from "@projectos/db/schema";
import { loadAuthContext } from "@projectos/auth";
import { bootstrapOrganization, createMemberDirect } from "@projectos/core";
import { approveRule, createAuthority, createPractitioner, createRuleDraft, submitAuthority, verifyAuthority } from "@projectos/credentialing";
import { dispatchOutbox } from "@projectos/notifications";
import {
  changeAppointmentStatus,
  checkInAppointment,
  confirmPendingAppointment,
  createAppointment,
  createAppointmentType,
  createPatient,
  createTemplate,
  downtimeSchedule,
  searchSlots,
} from "@projectos/scheduling";
import {
  connectSimulator,
  pullEhrChanges,
  reconcileConnection,
  resolveConflict,
  runHealthCheck,
  setSimFailureMode,
  simulateEhrSideBooking,
  simulateEhrSideChange,
  syncAvailability,
} from "@projectos/integrations";
import { addDays, appMode, isSyntheticMode, todayIn, weekdayOf } from "@projectos/shared";
import { recordDrill } from "./service";

/**
 * SYNTHETIC CLINIC-DAY REHEARSAL. Builds an isolated synthetic organization (never touches the demo org), runs one
 * scripted day at an EHR-master site against the synthetic EHR simulator — morning sync, bookings, an EHR outage with
 * drafts and a paper downtime list, recovery, an EHR-side cancellation, a timeout-retry, check-ins, a no-show and
 * end-of-day reconciliation — and asserts the safety properties at every step. Result is recorded in ops_drills.
 */
type Step = { at: string; step: string; ok: boolean; detail: string };

export async function runClinicDayRehearsal(db: Db, opts: { password?: string } = {}) {
  if (!isSyntheticMode(appMode())) throw new Error("The rehearsal creates synthetic data and runs only in synthetic modes.");
  process.env.SCHEDULING_MODE ??= "DEMO_ONLY";
  const started = new Date();
  const steps: Step[] = [];
  const check = (at: string, step: string, ok: boolean, detail: string) => steps.push({ at, step, ok, detail });

  // ---- setup: isolated synthetic org with one EHR-master site --------------------------------------------------
  const tag = started.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const { org, roleIds } = await bootstrapOrganization(db, { name: `Rehearsal Clinic ${tag} (SYNTHETIC)`, slug: `rehearsal-${tag}-${crypto.randomUUID().slice(0, 4)}` });
  const [site] = await db.insert(sites).values({ organizationId: org.id, code: "RH", name: "Rehearsal Clinic", state: "VA", timezone: "America/New_York" }).returning();
  await db.insert(departments).values({ organizationId: org.id, code: "OPS", name: "Operations" });
  const mk = async (name: string, role: string) =>
    (await loadAuthContext(
      db,
      (
        await createMemberDirect(db, {
          organizationId: org.id,
          email: `${name}-${tag}-${crypto.randomUUID().slice(0, 4)}@rehearsal.example`,
          displayName: `${name} (Rehearsal)`,
          passwordHash: opts.password ?? "not-a-login",
          grants: [{ roleId: roleIds[role]! }],
        })
      ).userId,
    ))!;
  const admin = await mk("ops-admin", "org_admin");
  const spec = await mk("cred-spec", "credentialing_specialist");
  const approver = await mk("cred-approver", "credentialing_approver");
  const compliance = await mk("compliance", "compliance_officer");

  // Next Monday (rehearsal day) in the site zone; the clock is simulated per step.
  const today = todayIn("America/New_York");
  let day = addDays(today, 1);
  while (weekdayOf(day) !== 1) day = addDays(day, 1);
  const at = (hhmm: string) => {
    const off = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" })
      .formatToParts(new Date(`${day}T12:00:00Z`))
      .find((p) => p.type === "timeZoneName")!
      .value.replace("GMT", "");
    return new Date(`${day}T${hhmm}:00${off || "+00:00"}`);
  };
  const prac = (await createPractitioner(db, admin, { displayName: "Dr. Rehearsal (SYNTHETIC)", profession: "PHYSICIAN", physicalState: "VA", siteIds: [site!.id] })).id;
  const type = (await createAppointmentType(db, admin, { code: "RH30", name: "Clinic visit 30", durationMinutes: 30, modalities: ["IN_PERSON"] }))!.id;
  for (const weekday of [1, 2, 3, 4, 5])
    await createTemplate(db, admin, { practitionerId: prac, siteId: site!.id, weekday, startTime: "08:00", endTime: "17:00", modalities: ["IN_PERSON"], effectiveFrom: today });
  const draft = await createRuleDraft(db, spec, {
    jurisdiction: "VA",
    profession: "PHYSICIAN",
    modality: "IN_PERSON",
    authorizationBasis: ["STATE_LICENSE"],
    effectiveFrom: addDays(today, -30),
    nextReviewOn: addDays(today, 365),
    sourceSummary: "DEMO SYNTHETIC POLICY — NOT VERIFIED LAW (rehearsal)",
    isDemo: true,
  });
  await approveRule(db, compliance, draft.id, { reason: "Rehearsal fixture only" });
  const lic = await createAuthority(db, spec, prac, {
    authorityType: "STATE_LICENSE",
    profession: "PHYSICIAN",
    jurisdiction: "VA",
    licenseNumberLast4: "0000",
    effectiveOn: addDays(today, -400),
    expiresOn: addDays(today, 700),
  });
  const sub = await submitAuthority(db, spec, lic.id, { version: lic.version });
  await verifyAuthority(db, approver, lic.id, { version: sub.version, sourceName: "Synthetic check (rehearsal)", verifiedOn: today });
  const pts: string[] = [];
  for (let i = 0; i < 12; i++) pts.push((await createPatient(db, admin, { displayName: `Rehearsal Patient ${String(i + 1).padStart(2, "0")}`, homeState: "VA" }))!.id);
  const conn = await connectSimulator(db, admin, site!.id);
  await db.update(sites).set({ ehrSyncMode: "EHR_MASTER", ehrFreshnessMinutes: 60 }).where(eq(sites.id, site!.id));
  const fresh = async () => (await db.select().from(ehrConnections).where(eq(ehrConnections.id, conn.id)))[0]!;
  const flush = () => dispatchOutbox(db, { limit: 500, types: ["ehr.write"] });
  const appt = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0]!;
  const book = (hhmm: string, p: number, now: Date, extra: Record<string, unknown> = {}) =>
    createAppointment(
      db,
      admin,
      {
        practitionerId: prac,
        siteId: site!.id,
        appointmentTypeId: type,
        modality: "IN_PERSON",
        startAt: at(hhmm).toISOString(),
        patientId: pts[p],
        patientLocationState: "VA",
        ...extra,
      },
      { now },
    );

  // ---- 07:00 morning sync ----------------------------------------------------------------------------------------
  let now = at("07:00");
  const h = await runHealthCheck(db, await fresh());
  const loc = "loc-rh";
  const pracExt = `prac-${prac.slice(0, 8)}`;
  await simulateEhrSideBooking(db, conn.id, { practitionerExternalId: pracExt, locationExternalId: loc, start: at("12:00"), end: at("13:00") });
  const s0 = await syncAvailability(db, await fresh(), now);
  check(
    "07:00",
    "Morning health check + availability sync",
    h.ok && s0.ok === true && (s0 as { imported: number }).imported === 1,
    `health ${h.ok}; EHR-only busy blocks imported: ${(s0 as { imported?: number }).imported ?? 0}`,
  );
  const offered = await searchSlots(
    db,
    admin,
    { appointmentTypeId: type, modality: "IN_PERSON", siteId: site!.id, practitionerId: prac, fromDate: day, days: 1, patientState: "VA", show: "all" },
    now,
  );
  const noon = (offered as unknown as { slots: { startAt: string }[] }).slots.some((s) => new Date(s.startAt).getTime() === at("12:00").getTime());
  check("07:05", "Time booked directly in the EHR is not offered", !noon, noon ? "12:00 was offered!" : "12:00–13:00 hidden (busy in EHR)");

  // ---- 08:00 bookings --------------------------------------------------------------------------------------------
  now = at("07:30");
  const morning: string[] = [];
  for (const [i, hhmm] of ["08:00", "08:30", "09:00", "09:30", "10:00", "13:00"].entries()) morning.push((await book(hhmm, i, now)).appointment.id);
  const before = await Promise.all(morning.map(appt));
  await flush();
  const after = await Promise.all(morning.map(appt));
  check(
    "07:35",
    "Bookings wait for the EHR, then confirm",
    before.every((a) => a.status === "PENDING" && a.ehrState === "PENDING_CREATE") && after.every((a) => a.status === "CONFIRMED" && a.ehrState === "SYNCED"),
    `${after.filter((a) => a.status === "CONFIRMED").length}/${morning.length} confirmed after EHR acceptance; none confirmed before`,
  );

  // ---- 10:00 EHR outage ------------------------------------------------------------------------------------------
  now = at("10:00");
  await setSimFailureMode(db, conn.id, "UNREACHABLE");
  await runHealthCheck(db, await fresh());
  let refused = 0;
  try {
    await book("14:00", 6, now);
  } catch (e) {
    if ((e as { code?: string }).code === "ELIGIBILITY_REVIEW") refused++;
  }
  const d1 = await book("14:00", 6, now, { acceptPendingReview: true });
  const d2 = await book("14:30", 7, now, { acceptPendingReview: true });
  let confirmBlocked = false;
  try {
    await confirmPendingAppointment(db, admin, d1.appointment.id, { version: d1.appointment.version }, now);
  } catch (e) {
    confirmBlocked = (e as { code?: string }).code === "SERVICE_UNAVAILABLE";
  }
  const paper = await downtimeSchedule(db, admin, { siteId: site!.id, date: day }, now);
  check(
    "10:05",
    "EHR outage: fail closed, drafts only, paper list printed",
    refused === 1 && confirmBlocked && [d1, d2].every((d) => d.appointment.status === "PENDING" && d.appointment.ehrState === "DRAFT") && paper.rows.length === 8,
    `direct booking refused (${refused}); confirm → 503 (${confirmBlocked}); 2 drafts; downtime list rows: ${paper.rows.length}`,
  );

  // ---- 11:00 recovery ------------------------------------------------------------------------------------------
  now = at("11:00");
  await setSimFailureMode(db, conn.id, "NONE");
  await runHealthCheck(db, await fresh());
  await syncAvailability(db, await fresh(), now);
  for (const d of [d1, d2]) {
    const cur = await appt(d.appointment.id);
    await confirmPendingAppointment(db, admin, cur.id, { version: cur.version }, now);
  }
  await flush();
  const rec = await Promise.all([d1, d2].map((d) => appt(d.appointment.id)));
  check(
    "11:05",
    "Recovery: drafts sent and confirmed by the EHR",
    rec.every((a) => a.status === "CONFIRMED" && a.ehrState === "SYNCED"),
    `${rec.filter((a) => a.status === "CONFIRMED").length}/2 confirmed`,
  );

  // ---- 11:30 EHR-side cancellation -------------------------------------------------------------------------------
  now = at("11:30");
  const [link] = await db.select().from(ehrAppointmentLinks).where(eq(ehrAppointmentLinks.appointmentId, morning[5]!));
  await simulateEhrSideChange(db, conn.id, link!.externalId, { cancel: true });
  await pullEhrChanges(db, await fresh());
  const flagged = await appt(morning[5]!);
  const [conf] = await db
    .select()
    .from(integrationConflicts)
    .where(and(eq(integrationConflicts.appointmentId, morning[5]!), eq(integrationConflicts.status, "OPEN")));
  if (conf) await resolveConflict(db, admin, conf.id, { action: "ACCEPT_EHR", note: "Rehearsal: patient cancelled by phone with EHR staff" }, now);
  const accepted = await appt(morning[5]!);
  check(
    "11:35",
    "EHR-side cancellation detected and accepted",
    flagged.status === "NEEDS_RESCHEDULE" && !!conf && accepted.status === "CANCELLED",
    `local status after change feed: ${flagged.status}; after Accept EHR: ${accepted.status}`,
  );

  // ---- 12:00 timeout after write → retry -------------------------------------------------------------------------
  now = at("11:45");
  await setSimFailureMode(db, conn.id, "TIMEOUT_AFTER_WRITE");
  const tw = await book("15:00", 8, now);
  await flush();
  await setSimFailureMode(db, conn.id, "NONE");
  await db.execute(sql`update outbox_events set available_at = now() - interval '1 second' where status = 'FAILED' and payload->>'appointmentId' = ${tw.appointment.id}`);
  await flush();
  const [remoteCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ehrSimAppointments)
    .where(and(eq(ehrSimAppointments.connectionId, conn.id), eq(ehrSimAppointments.idempotencyKey, `projectos:appointment:${tw.appointment.id}:create`)));
  const twA = await appt(tw.appointment.id);
  check(
    "12:00",
    "Timeout after EHR write: retry creates no duplicate",
    remoteCount!.n === 1 && twA.status === "CONFIRMED",
    `EHR appointments for the booking: ${remoteCount!.n}; status ${twA.status}`,
  );

  // ---- clinic: check-ins, completion, no-show ------------------------------------------------------------------
  let checkedIn = 0;
  for (const [i, id] of morning.slice(0, 4).entries()) {
    now = new Date((await appt(id)).startAt.getTime() - 5 * 60_000);
    await syncAvailability(db, await fresh(), now);
    const a = await appt(id);
    const r = await checkInAppointment(db, admin, id, { version: a.version, locationConfirmed: true }, now);
    if ((r as { status?: string }).status === "CHECKED_IN" || (r as { appointment?: { status: string } }).appointment?.status === "CHECKED_IN") checkedIn++;
    const c = await appt(id);
    if (i < 3) await changeAppointmentStatus(db, admin, id, { version: c.version, status: "COMPLETED" }, new Date(c.endAt.getTime() + 60_000));
  }
  const ns = await appt(morning[4]!);
  await changeAppointmentStatus(db, admin, ns.id, { version: ns.version, status: "NO_SHOW" }, new Date(ns.startAt.getTime() + 20 * 60_000));
  check("13:30", "Check-ins re-evaluate eligibility; visits completed; no-show recorded", checkedIn === 4, `${checkedIn}/4 checked in; 3 completed; 1 no-show`);

  // ---- 17:30 end-of-day reconciliation ---------------------------------------------------------------------------
  now = at("17:30");
  const recon = await reconcileConnection(db, await fresh(), now);
  const dead = await db.execute<{ n: number }>(sql`select count(*)::int as n from outbox_events where organization_id = ${org.id} and status = 'DEAD'`);
  const openConflicts = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(integrationConflicts)
    .where(and(eq(integrationConflicts.organizationId, org.id), eq(integrationConflicts.status, "OPEN")));
  check(
    "17:30",
    "End-of-day reconciliation clean; no dead letters",
    recon.ok === true && (recon as { missing: number }).missing === 0 && Number(dead[0]?.n ?? 0) === 0 && openConflicts[0]!.n === 0,
    `checked ${(recon as { checked?: number }).checked ?? 0} mappings, missing ${(recon as { missing?: number }).missing ?? "?"}, open conflicts ${openConflicts[0]!.n}, dead letters ${Number(dead[0]?.n ?? 0)}`,
  );

  // Retire the rehearsal site so the worker stops syncing it (the records stay as evidence).
  await db.update(ehrConnections).set({ enabled: false }).where(eq(ehrConnections.id, conn.id));
  await db.update(sites).set({ active: false }).where(eq(sites.id, site!.id));
  const pass = steps.every((s) => s.ok);
  const summary = { organizationId: org.id, rehearsalDay: day, steps, passed: steps.filter((s) => s.ok).length, total: steps.length };
  await recordDrill(db, { organizationId: org.id, kind: "CLINIC_DAY_REHEARSAL", status: pass ? "PASS" : "FAIL", startedAt: started, summary, runBy: "pnpm ops:rehearsal" });
  return { pass, ...summary };
}

export function rehearsalMarkdown(r: Awaited<ReturnType<typeof runClinicDayRehearsal>>) {
  const lines = [
    `# Clinic-day rehearsal — ${r.pass ? "PASS" : "FAIL"} (SYNTHETIC)`,
    "",
    `Rehearsal day ${r.rehearsalDay}, isolated synthetic organization ${r.organizationId}, EHR-master site on the synthetic EHR simulator.`,
    "",
    "| Time | Step | Result | Detail |",
    "|---|---|---|---|",
    ...r.steps.map((s) => `| ${s.at} | ${s.step} | ${s.ok ? "✅ PASS" : "❌ FAIL"} | ${s.detail} |`),
    "",
    `${r.passed}/${r.total} steps passed. NOT APPROVED FOR REAL PHI — this exercises software behavior with synthetic data only.`,
  ];
  return lines.join("\n");
}

if (isMain(import.meta.url)) {
  loadRootEnv();
  const { db, sql: conn } = createDb(undefined, 3);
  runClinicDayRehearsal(db)
    .then((r) => {
      console.log(rehearsalMarkdown(r));
      if (!r.pass) process.exitCode = 1;
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => conn.end());
}
