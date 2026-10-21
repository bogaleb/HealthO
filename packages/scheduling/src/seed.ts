import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { createDb, isMain, loadRootEnv, type Db } from "@projectos/db";
import { appointmentTypes, memberships, practitioners, roles, services, sites, users } from "@projectos/db/schema";
import { loadAuthContext } from "@projectos/auth";
import { createMemberDirect, findOrgBySlug } from "@projectos/core";
import { addDays, appMode, isSyntheticMode, resolveLocal, todayIn, weekdayOf } from "@projectos/shared";
import { createAppointmentType, createException, createRoom, createTemplate } from "./config";
import { createPatient } from "./patients";
import { searchSlots } from "./availability";
import { createAppointment } from "./booking";
import { createWaitlistEntry } from "./waitlist";

/** SYNTHETIC scheduling demo data: fictional patients DEMO-0001…, working hours, rooms, a few bookings. */
export const SCHED_USERS = { manager: { email: "quinn.park@riverbend.example", name: "Quinn Park (Demo)" } } as const;

export async function seedScheduling(db: Db, password: string, slug = "riverbend-demo", now = new Date()) {
  if (!isSyntheticMode(appMode())) throw new Error("Scheduling demo seed runs only in synthetic modes.");
  process.env.SCHEDULING_MODE ??= "DEMO_ONLY"; // seed-only: book the demo appointments below
  const org = await findOrgBySlug(db, slug);
  if (!org) throw new Error("Run the core seed first.");
  const o = org.id;
  const [already] = await db.select({ id: appointmentTypes.id }).from(appointmentTypes).where(eq(appointmentTypes.organizationId, o)).limit(1);
  if (already) return { skipped: true as const };

  const [adminM] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, o), eq(users.email, "avery.admin@riverbend.example")));
  const admin = (await loadAuthContext(db, adminM!.userId, "seed"))!;

  // Scheduling manager (org-wide) — configures hours, rooms, time off.
  const [existingQuinn] = await db.select({ id: users.id }).from(users).where(eq(users.email, SCHED_USERS.manager.email));
  if (!existingQuinn) {
    const [mgrRole] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, o), eq(roles.key, "scheduling_manager")));
    await createMemberDirect(db, {
      organizationId: o,
      email: SCHED_USERS.manager.email,
      displayName: SCHED_USERS.manager.name,
      passwordHash: await hashPassword(password),
      professionalRole: "Scheduling Manager",
      grants: [{ roleId: mgrRole!.id }],
    });
  }

  const svc = new Map((await db.select().from(services).where(eq(services.organizationId, o))).map((s) => [s.code, s.id]));
  const siteRows = await db.select().from(sites).where(eq(sites.organizationId, o));
  const site = (code: string) => siteRows.find((s) => s.code === code)!.id;
  const provRows = await db.select().from(practitioners).where(eq(practitioners.organizationId, o));
  const prov = (prefix: string) => provRows.find((p) => p.displayName.startsWith(`Practitioner ${prefix} `))!.id;

  const types = {
    PC_NEW: await createAppointmentType(db, admin, {
      code: "PC_NEW",
      name: "New patient — primary care",
      serviceId: svc.get("PC-VISIT"),
      durationMinutes: 40,
      bufferAfterMinutes: 10,
      modalities: ["IN_PERSON", "VIDEO"],
      requiresRoom: true,
      minNoticeMinutes: 60,
    }),
    PC_FU: await createAppointmentType(db, admin, {
      code: "PC_FU",
      name: "Follow-up — primary care",
      serviceId: svc.get("PC-VISIT"),
      durationMinutes: 20,
      bufferAfterMinutes: 5,
      modalities: ["IN_PERSON", "VIDEO"],
      requiresRoom: true,
      minNoticeMinutes: 30,
    }),
    BH_THERAPY: await createAppointmentType(db, admin, {
      code: "BH_THERAPY",
      name: "Therapy follow-up",
      serviceId: svc.get("BH-THERAPY"),
      durationMinutes: 50,
      bufferAfterMinutes: 10,
      modalities: ["IN_PERSON", "VIDEO", "AUDIO_ONLY"],
      requiresRoom: true,
      minNoticeMinutes: 60,
    }),
    PSY_EVAL: await createAppointmentType(db, admin, {
      code: "PSY_EVAL",
      name: "Psychological evaluation",
      serviceId: svc.get("PSY-EVAL"),
      durationMinutes: 120,
      bufferAfterMinutes: 15,
      modalities: ["IN_PERSON"],
      requiresRoom: true,
      minNoticeMinutes: 1440,
    }),
    RN_FU: await createAppointmentType(db, admin, {
      code: "RN_FU",
      name: "Nurse follow-up",
      serviceId: svc.get("RN-VISIT"),
      durationMinutes: 20,
      bufferAfterMinutes: 5,
      modalities: ["IN_PERSON", "VIDEO"],
      requiresRoom: true,
    }),
  };

  for (const [code, rs] of [
    ["ALX", ["EX-1", "EX-2"]],
    ["SSP", ["EX-1", "EX-2"]],
    ["NEDC", ["TH-1"]],
  ] as const) {
    for (const r of rs) await createRoom(db, admin, { siteId: site(code), code: r, name: `${r.startsWith("TH") ? "Therapy room" : "Exam room"} ${r.slice(-1)} (SYNTHETIC)` });
  }

  const today = todayIn("America/New_York", now);
  const from = addDays(today, -30);
  const ALL = ["IN_PERSON", "VIDEO", "AUDIO_ONLY"];
  const IPV = ["IN_PERSON", "VIDEO"];
  const week = async (p: string, s: string, days: number[], blocks: [string, string][], modalities: string[]) => {
    for (const weekday of days)
      for (const [startTime, endTime] of blocks)
        await createTemplate(db, admin, { practitionerId: prov(p), siteId: site(s), weekday, startTime, endTime, modalities, effectiveFrom: from });
  };
  const fullDay: [string, string][] = [
    ["08:00", "12:00"],
    ["13:00", "17:00"],
  ];
  const nineToFive: [string, string][] = [
    ["09:00", "12:00"],
    ["13:00", "17:00"],
  ];
  await week("A", "ALX", [1, 2, 3, 4, 5], fullDay, IPV);
  await week("B", "SSP", [1, 3, 5], [["08:00", "12:00"]], IPV);
  await week("B", "ALX", [2, 4], [["08:00", "12:00"]], IPV);
  await week("B2", "SSP", [1, 2, 3, 4], nineToFive, IPV);
  await week("C", "NEDC", [1, 2, 3, 4, 5], nineToFive, ALL);
  await week("D", "ALX", [1, 3], nineToFive, ALL);
  await week("D", "SSP", [2, 4], nineToFive, ALL);
  await week("G", "SSP", [1, 2, 3, 4, 5], fullDay, IPV);

  // Time off for A on the next weekday 8+ days out, and a training-day closure at SSP 10+ days out.
  const nextWeekday = (d: string) => {
    let x = d;
    while ([0, 6].includes(weekdayOf(x))) x = addDays(x, 1);
    return x;
  };
  const at = (date: string, t: string) => {
    const r = resolveLocal(date, t, "America/New_York");
    return (r.kind === "ok" ? r.instant : r.kind === "ambiguous" ? r.instants[0] : new Date(`${date}T12:00:00Z`)).toISOString();
  };
  const ptoDay = nextWeekday(addDays(today, 8));
  await createException(db, admin, {
    kind: "PTO",
    practitionerId: prov("A"),
    startAt: at(ptoDay, "00:00"),
    endAt: at(addDays(ptoDay, 1), "00:00"),
    reason: "Vacation (SYNTHETIC)",
  });
  const closureDay = nextWeekday(addDays(today, 10));
  await createException(db, admin, {
    kind: "CLOSURE",
    siteId: site("SSP"),
    startAt: at(closureDay, "00:00"),
    endAt: at(addDays(closureDay, 1), "00:00"),
    reason: "Staff training day — site closed (SYNTHETIC)",
  });

  const states = ["VA", "VA", "MD", "DC", "VA", "MD", "VA", "DC", "MD", "VA", "VA", "MD", "DC", "VA", "MD"];
  const pts: NonNullable<Awaited<ReturnType<typeof createPatient>>>[] = [];
  for (let i = 0; i < states.length; i++) {
    pts.push((await createPatient(db, admin, { displayName: `Demo Patient ${String(i + 1).padStart(2, "0")} (SYNTHETIC)`, birthYear: 1950 + i * 3, homeState: states[i] }))!);
  }

  // A few bookings over the next working days, chosen from real search results so they are valid.
  // A few bookings over the next working days, chosen from real eligible search results (Phase 5 rules apply).
  let booked = 0;
  const book = async (
    p: string,
    s: string,
    typeId: string,
    modality: "IN_PERSON" | "VIDEO",
    picks: number[],
    startDate: string,
    o: { location?: string; acceptPendingReview?: boolean } = {},
  ) => {
    for (const i of picks) {
      // Search again after each booking: grid slots overlap each other (15-min step), so stale results would clash.
      const patientState = modality === "IN_PERSON" ? siteRows.find((x) => x.id === site(s))!.state : (o.location ?? "VA");
      const r = await searchSlots(
        db,
        admin,
        {
          appointmentTypeId: typeId,
          modality,
          siteId: site(s),
          practitionerId: prov(p),
          fromDate: startDate,
          days: 5,
          patientState,
          show: o.acceptPendingReview ? "all" : "eligible",
        },
        now,
      );
      const slot = r.slots[i];
      if (!slot) continue;
      const patient = pts[booked % pts.length]!;
      await createAppointment(
        db,
        admin,
        {
          practitionerId: slot.practitionerId,
          siteId: slot.siteId,
          appointmentTypeId: typeId,
          modality,
          startAt: slot.startAt,
          patientId: patient.id,
          patientLocationState: patientState,
          patientLocationStatus: "PROPOSED",
          acceptPendingReview: !!o.acceptPendingReview,
        },
        { now },
      );
      booked++;
    }
  };
  const start = addDays(today, 1);
  await book("A", "ALX", types.PC_FU!.id, "IN_PERSON", [0, 3, 7, 12], start);
  await book("A", "ALX", types.PC_NEW!.id, "VIDEO", [20], start, { location: "VA" });
  // Fixture B/C: VA-only physician, patient physically in MD for a video visit → saved PENDING for review (not confirmed).
  await book("A", "ALX", types.PC_NEW!.id, "VIDEO", [30], start, { location: "MD", acceptPendingReview: true });
  await book("C", "NEDC", types.BH_THERAPY!.id, "VIDEO", [0, 5, 14], start, { location: "VA" });
  await book("D", "SSP", types.BH_THERAPY!.id, "IN_PERSON", [1, 4], start);
  await book("D", "ALX", types.BH_THERAPY!.id, "VIDEO", [1, 6], start, { location: "MD" });

  // Fixture J: NEDC's master schedule lives in an EHR that has not synchronized recently (adapter is a stub).
  await db
    .update(sites)
    .set({ ehrSyncMode: "EHR_MASTER", ehrLastSyncedAt: new Date(now.getTime() - 3 * 3600_000), ehrFreshnessMinutes: 60 })
    .where(eq(sites.id, site("NEDC")));

  // A waitlist request: Tue–Fri after 2 PM, behavioral follow-up by video, patient in VA.
  await createWaitlistEntry(db, admin, {
    patientId: pts[5]!.id,
    appointmentTypeId: types.BH_THERAPY!.id,
    modality: "VIDEO",
    patientLocationState: "VA",
    earliestDate: start,
    latestDate: addDays(start, 13),
    weekdays: [2, 3, 4, 5],
    afterTime: "14:00",
    priority: 1,
    note: "Prefers afternoons (synthetic)",
  });
  return { skipped: false as const, appointmentTypes: Object.keys(types).length, patients: pts.length, appointments: booked };
}

if (isMain(import.meta.url)) {
  loadRootEnv();
  const pw = process.env.DEMO_PASSWORD;
  if (!pw || pw.length < 12) {
    console.error("DEMO_PASSWORD must be set (>= 12 chars) in .env.");
    process.exit(1);
  }
  const { sql, db } = createDb(undefined, 2);
  seedScheduling(db, pw)
    .then((r) => console.log(JSON.stringify({ level: "info", msg: r.skipped ? "scheduling demo data already seeded — skipping" : "synthetic scheduling data seeded", ...r })))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}
