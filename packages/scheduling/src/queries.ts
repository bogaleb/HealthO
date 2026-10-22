import { and, asc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@projectos/db";
import {
  eligibilityEvaluations,
  payerPlans,
  appointmentEvents,
  appointmentHolds,
  appointmentTypes,
  appointments,
  memberships,
  organizations,
  patients,
  practitionerSites,
  practitioners,
  rooms,
  scheduleExceptions,
  scheduleTemplates,
  sites,
} from "@projectos/db/schema";
import { can, hasAny, type AuthContext } from "@projectos/auth";
import { audit, parse } from "@projectos/core";
import { addDays, boundaryInstant, calendarQuery, notFound, weekdayOf } from "@projectos/shared";
import { bookingEnabled, requireAnywhere, siteScope } from "./access";
import { expandTemplates } from "./slots";

const RESTRICTED = "Patient (restricted)";

/**
 * Latest persisted evaluation + whether it is stale. UI and API both read this object, so "stale" means the
 * same thing everywhere: older than EVALUATION_TTL_MINUTES → re-check before relying on it.
 */
async function eligibilityView(db: Db, organizationId: string, appointmentId: string, latestId: string | null, now = new Date()) {
  const history = await db
    .select({
      id: eligibilityEvaluations.id,
      trigger: eligibilityEvaluations.trigger,
      decision: eligibilityEvaluations.decision,
      jurisdiction: eligibilityEvaluations.jurisdiction,
      evaluatedAt: eligibilityEvaluations.evaluatedAt,
    })
    .from(eligibilityEvaluations)
    .where(and(eq(eligibilityEvaluations.organizationId, organizationId), eq(eligibilityEvaluations.appointmentId, appointmentId)))
    .orderBy(asc(eligibilityEvaluations.evaluatedAt));
  const [latest] = latestId
    ? await db
        .select()
        .from(eligibilityEvaluations)
        .where(and(eq(eligibilityEvaluations.organizationId, organizationId), eq(eligibilityEvaluations.id, latestId)))
    : [];
  return {
    eligibility: latest ? { ...latest, stale: latest.expiresAt <= now } : null,
    eligibilityHistory: history,
  };
}

/** Appointment detail + append-only history. Patient name only with patients.read. */
export async function getAppointment(db: Db, ctx: AuthContext, id: string) {
  const [row] = await db
    .select({
      a: appointments,
      patientName: patients.displayName,
      patientMrn: patients.mrn,
      practitionerName: practitioners.displayName,
      profession: practitioners.profession,
      siteCode: sites.code,
      siteName: sites.name,
      siteState: sites.state,
      typeName: appointmentTypes.name,
      roomCode: rooms.code,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(practitioners, eq(practitioners.id, appointments.practitionerId))
    .innerJoin(sites, eq(sites.id, appointments.siteId))
    .innerJoin(appointmentTypes, eq(appointmentTypes.id, appointments.appointmentTypeId))
    .leftJoin(rooms, eq(rooms.id, appointments.roomId))
    .where(and(eq(appointments.organizationId, ctx.organizationId), eq(appointments.id, id)));
  if (!row || !can(ctx, "scheduling.read", { siteId: row.a.siteId })) throw notFound("Appointment");
  const showPatient = hasAny(ctx, "patients.read");
  const actor = alias(memberships, "actor");
  const events = await db
    .select({ e: appointmentEvents, actorName: actor.displayName })
    .from(appointmentEvents)
    .leftJoin(actor, and(eq(actor.userId, appointmentEvents.actorUserId), eq(actor.organizationId, appointmentEvents.organizationId)))
    .where(and(eq(appointmentEvents.organizationId, ctx.organizationId), eq(appointmentEvents.appointmentId, id)))
    .orderBy(asc(appointmentEvents.at));
  // Opening an appointment that shows the patient's identity is a patient-record read (PHI-readiness audit coverage).
  if (showPatient) await audit(db, ctx, { action: "patient.read", resourceType: "appointment", resourceId: id, metadata: { via: "appointment" } });
  return {
    ...row.a,
    patientName: showPatient ? row.patientName : RESTRICTED,
    patientMrn: showPatient ? row.patientMrn : null,
    practitionerName: row.practitionerName,
    profession: row.profession,
    siteCode: row.siteCode,
    siteName: row.siteName,
    siteState: row.siteState,
    typeName: row.typeName,
    roomCode: row.roomCode,
    canManage: can(ctx, "scheduling.manage", { siteId: row.a.siteId }),
    bookingEnabled: bookingEnabled(),
    events: events.map(({ e, actorName }) => ({ ...e, actorName: actorName ?? (e.actorSystem ? `System (${e.actorSystem})` : "—") })),
    payerPlanName: row.a.payerPlanId ? ((await db.select({ name: payerPlans.name }).from(payerPlans).where(eq(payerPlans.id, row.a.payerPlanId)))[0]?.name ?? null) : null,
    ...(await eligibilityView(db, ctx.organizationId, id, row.a.eligibilityEvaluationId)),
  };
}

/**
 * Day or week calendar. Day boundaries are computed in the displayed time zone (selected site's, else the
 * organization's), so DST days are 23 or 25 hours long, not 24.
 */
export async function getCalendar(db: Db, ctx: AuthContext, input: unknown) {
  await requireAnywhere(db, ctx, "scheduling.read", "scheduling.calendar", "calendar");
  const q = parse(calendarQuery, input);
  const scope = siteScope(ctx, "scheduling.read");
  const [org] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.organizationId));
  const siteRows = await db
    .select({ id: sites.id, code: sites.code, name: sites.name, state: sites.state, timezone: sites.timezone })
    .from(sites)
    .where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.active, true), scope ? (scope.length ? inArray(sites.id, scope) : sql`false`) : undefined))
    .orderBy(asc(sites.code));
  const site = q.siteId ? siteRows.find((s) => s.id === q.siteId) : undefined;
  if (q.siteId && !site) throw notFound("Site");
  const timezone = site?.timezone ?? org!.tz;
  const visibleSiteIds = site ? [site.id] : siteRows.map((s) => s.id);
  // Week starts on Monday.
  const start = q.view === "week" ? addDays(q.date, -((weekdayOf(q.date) + 6) % 7)) : q.date;
  const days = q.view === "week" ? 7 : 1;
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const from = boundaryInstant(start, "00:00", timezone, "start");
  const to = boundaryInstant(addDays(start, days), "00:00", timezone, "start");

  const allProvRows = visibleSiteIds.length
    ? await db
        .selectDistinct({ id: practitioners.id, displayName: practitioners.displayName, profession: practitioners.profession })
        .from(practitioners)
        .innerJoin(practitionerSites, eq(practitionerSites.practitionerId, practitioners.id))
        .where(and(eq(practitioners.organizationId, ctx.organizationId), eq(practitioners.active, true), inArray(practitionerSites.siteId, visibleSiteIds)))
        .orderBy(asc(practitioners.displayName))
    : [];
  const provRows = q.practitionerId ? allProvRows.filter((p) => p.id === q.practitionerId) : allProvRows;
  const provIds = provRows.map((p) => p.id);
  const showPatient = hasAny(ctx, "patients.read");

  const appts = provIds.length
    ? await db
        .select({
          id: appointments.id,
          practitionerId: appointments.practitionerId,
          siteId: appointments.siteId,
          status: appointments.status,
          modality: appointments.modality,
          startAt: appointments.startAt,
          endAt: appointments.endAt,
          reservedStartAt: appointments.reservedStartAt,
          reservedEndAt: appointments.reservedEndAt,
          patientLocationState: appointments.patientLocationState,
          eligibilityStatus: appointments.eligibilityStatus,
          eligibilityDecision: appointments.eligibilityDecision,
          version: appointments.version,
          patientName: patients.displayName,
          typeName: appointmentTypes.name,
          roomCode: rooms.code,
          siteCode: sites.code,
        })
        .from(appointments)
        .innerJoin(patients, eq(patients.id, appointments.patientId))
        .innerJoin(appointmentTypes, eq(appointmentTypes.id, appointments.appointmentTypeId))
        .innerJoin(sites, eq(sites.id, appointments.siteId))
        .leftJoin(rooms, eq(rooms.id, appointments.roomId))
        .where(
          and(
            eq(appointments.organizationId, ctx.organizationId),
            inArray(appointments.siteId, visibleSiteIds),
            inArray(appointments.practitionerId, provIds),
            ne(appointments.status, "CANCELLED"),
            lt(appointments.startAt, to),
            gt(appointments.endAt, from),
          ),
        )
        .orderBy(asc(appointments.startAt))
    : [];
  const holds = provIds.length
    ? await db
        .select({
          id: appointmentHolds.id,
          practitionerId: appointmentHolds.practitionerId,
          siteId: appointmentHolds.siteId,
          startAt: appointmentHolds.startAt,
          endAt: appointmentHolds.endAt,
          expiresAt: appointmentHolds.expiresAt,
        })
        .from(appointmentHolds)
        .where(
          and(
            eq(appointmentHolds.organizationId, ctx.organizationId),
            eq(appointmentHolds.status, "ACTIVE"),
            inArray(appointmentHolds.siteId, visibleSiteIds),
            inArray(appointmentHolds.practitionerId, provIds),
            lt(appointmentHolds.startAt, to),
            gt(appointmentHolds.endAt, from),
          ),
        )
    : [];
  const exceptions = await db
    .select({
      id: scheduleExceptions.id,
      kind: scheduleExceptions.kind,
      practitionerId: scheduleExceptions.practitionerId,
      siteId: scheduleExceptions.siteId,
      startAt: scheduleExceptions.startAt,
      endAt: scheduleExceptions.endAt,
      reason: scheduleExceptions.reason,
    })
    .from(scheduleExceptions)
    .where(
      and(
        eq(scheduleExceptions.organizationId, ctx.organizationId),
        isNull(scheduleExceptions.cancelledAt),
        lt(scheduleExceptions.startAt, to),
        gt(scheduleExceptions.endAt, from),
      ),
    );
  const templates = provIds.length
    ? await db
        .select()
        .from(scheduleTemplates)
        .where(
          and(
            eq(scheduleTemplates.organizationId, ctx.organizationId),
            eq(scheduleTemplates.active, true),
            inArray(scheduleTemplates.practitionerId, provIds),
            inArray(scheduleTemplates.siteId, visibleSiteIds),
          ),
        )
    : [];
  const zones = new Map(siteRows.map((s) => [s.id, s.timezone]));
  const blocks = expandTemplates(templates, zones, start, days);
  const siteCode = new Map(siteRows.map((s) => [s.id, s.code]));

  return {
    view: q.view,
    timezone,
    dates,
    from: from.toISOString(),
    to: to.toISOString(),
    site: site ?? null,
    sites: siteRows,
    practitioners: provRows,
    allPractitioners: allProvRows,
    bookingEnabled: bookingEnabled(),
    appointments: appts.map((a) => ({ ...a, patientName: showPatient ? a.patientName : RESTRICTED })),
    holds,
    exceptions: exceptions.filter((e) => (e.siteId && visibleSiteIds.includes(e.siteId)) || (e.practitionerId && provIds.includes(e.practitionerId))),
    workingBlocks: blocks.map((b) => ({
      practitionerId: b.practitionerId,
      siteId: b.siteId,
      siteCode: siteCode.get(b.siteId) ?? "",
      start: b.start,
      end: b.end,
      date: b.date,
      modalities: b.modalities,
    })),
  };
}
