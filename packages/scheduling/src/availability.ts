import { and, asc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@projectos/db";
import {
  appointmentTypes,
  practitionerServices,
  practitionerSites,
  practitioners,
  resourceReservations,
  rooms,
  scheduleExceptions,
  scheduleTemplates,
  sites,
} from "@projectos/db/schema";
import type { AuthContext } from "@projectos/auth";
import { parse } from "@projectos/core";
import { addDays, AppError, ELIGIBILITY_POLICY_PENDING, notFound, slotSearch, SLOT_STEP_MINUTES, type Modality } from "@projectos/shared";
import { requireAnywhere, siteScope } from "./access";
import { expandTemplates, generateSlots, type Range, type RoomLike, type SlotInput } from "./slots";

type AppointmentType = typeof appointmentTypes.$inferSelect;

export async function loadType(db: DbOrTx, organizationId: string, id: string): Promise<AppointmentType> {
  const [t] = await db
    .select()
    .from(appointmentTypes)
    .where(and(eq(appointmentTypes.organizationId, organizationId), eq(appointmentTypes.id, id)));
  if (!t) throw new AppError("VALIDATION_FAILED", "Unknown appointment type.", [{ code: "UNKNOWN_TYPE", field: "appointmentTypeId" }]);
  return t;
}

/** Providers who can deliver this type/modality at the given sites (affiliation, service, telehealth capability). */
export async function candidatePractitioners(
  db: DbOrTx,
  organizationId: string,
  type: AppointmentType,
  modality: Modality,
  q: { siteIds: string[] | null; practitionerId?: string },
) {
  const rows = await db
    .select({ id: practitioners.id, displayName: practitioners.displayName, profession: practitioners.profession, siteId: practitionerSites.siteId })
    .from(practitioners)
    .innerJoin(practitionerSites, and(eq(practitionerSites.practitionerId, practitioners.id), eq(practitionerSites.organizationId, practitioners.organizationId)))
    .where(
      and(
        eq(practitioners.organizationId, organizationId),
        eq(practitioners.active, true),
        modality === "IN_PERSON" ? undefined : eq(practitioners.telehealthCapable, true),
        q.practitionerId ? eq(practitioners.id, q.practitionerId) : undefined,
        q.siteIds ? (q.siteIds.length ? inArray(practitionerSites.siteId, q.siteIds) : sql`false`) : undefined,
        type.serviceId
          ? sql`exists (select 1 from ${practitionerServices} psv where psv.practitioner_id = "practitioners"."id" and psv.service_id = ${type.serviceId})`
          : undefined,
      ),
    )
    .orderBy(asc(practitioners.displayName));
  return rows;
}

/**
 * Load everything the pure slot engine needs for a window. `exclude*` lets a reschedule ignore the
 * appointment's own reservations and a booking ignore the hold it is converting.
 */
export async function loadAvailability(
  db: DbOrTx,
  organizationId: string,
  q: {
    practitionerIds: string[];
    siteIds: string[];
    fromDate: string;
    days: number;
    type: AppointmentType;
    modality: Modality;
    now: Date;
    excludeAppointmentId?: string;
    excludeHoldId?: string;
  },
): Promise<{ input: Omit<SlotInput, "stepMinutes">; siteZones: Map<string, string> }> {
  const siteRows = q.siteIds.length
    ? await db
        .select({ id: sites.id, timezone: sites.timezone })
        .from(sites)
        .where(and(eq(sites.organizationId, organizationId), inArray(sites.id, q.siteIds)))
    : [];
  const siteZones = new Map(siteRows.map((s) => [s.id, s.timezone]));
  const lastDate = addDays(q.fromDate, q.days);
  const templates = q.practitionerIds.length
    ? await db
        .select()
        .from(scheduleTemplates)
        .where(
          and(
            eq(scheduleTemplates.organizationId, organizationId),
            eq(scheduleTemplates.active, true),
            inArray(scheduleTemplates.practitionerId, q.practitionerIds),
            q.siteIds.length ? inArray(scheduleTemplates.siteId, q.siteIds) : sql`false`,
            sql`${scheduleTemplates.effectiveFrom} <= ${lastDate}::date`,
            or(isNull(scheduleTemplates.effectiveTo), sql`${scheduleTemplates.effectiveTo} >= ${q.fromDate}::date`),
          ),
        )
    : [];
  const blocks = expandTemplates(templates, siteZones, q.fromDate, q.days);
  // Window padded by a day on both sides covers every zone offset and buffer.
  const from = new Date(`${addDays(q.fromDate, -1)}T00:00:00Z`);
  const to = new Date(`${addDays(lastDate, 1)}T00:00:00Z`);

  const resv = q.practitionerIds.length
    ? await db
        .select({ resourceId: resourceReservations.resourceId, start: resourceReservations.startAt, end: resourceReservations.endAt })
        .from(resourceReservations)
        .where(
          and(
            eq(resourceReservations.organizationId, organizationId),
            eq(resourceReservations.state, "ACTIVE"),
            eq(resourceReservations.resourceType, "PRACTITIONER"),
            inArray(resourceReservations.resourceId, q.practitionerIds),
            lt(resourceReservations.startAt, to),
            gt(resourceReservations.endAt, from),
            q.excludeAppointmentId ? or(isNull(resourceReservations.appointmentId), ne(resourceReservations.appointmentId, q.excludeAppointmentId)) : undefined,
            q.excludeHoldId ? or(isNull(resourceReservations.holdId), ne(resourceReservations.holdId, q.excludeHoldId)) : undefined,
          ),
        )
    : [];
  const practitionerBusy = new Map<string, Range[]>();
  for (const r of resv) practitionerBusy.set(r.resourceId, [...(practitionerBusy.get(r.resourceId) ?? []), { start: r.start, end: r.end }]);

  const exc = await db
    .select()
    .from(scheduleExceptions)
    .where(
      and(eq(scheduleExceptions.organizationId, organizationId), isNull(scheduleExceptions.cancelledAt), lt(scheduleExceptions.startAt, to), gt(scheduleExceptions.endAt, from)),
    );
  const practitionerExceptions = new Map<string, Range[]>();
  const siteClosures = new Map<string, Range[]>();
  for (const e of exc) {
    const r = { start: e.startAt, end: e.endAt };
    if (e.kind === "CLOSURE" && e.siteId) siteClosures.set(e.siteId, [...(siteClosures.get(e.siteId) ?? []), r]);
    else if (e.practitionerId) practitionerExceptions.set(e.practitionerId, [...(practitionerExceptions.get(e.practitionerId) ?? []), r]);
  }

  let roomList: RoomLike[] = [];
  if (q.siteIds.length) {
    const rs = await db
      .select({ id: rooms.id, code: rooms.code, siteId: rooms.siteId })
      .from(rooms)
      .where(and(eq(rooms.organizationId, organizationId), eq(rooms.active, true), inArray(rooms.siteId, q.siteIds)))
      .orderBy(asc(rooms.code));
    const busy = rs.length
      ? await db
          .select({ resourceId: resourceReservations.resourceId, start: resourceReservations.startAt, end: resourceReservations.endAt })
          .from(resourceReservations)
          .where(
            and(
              eq(resourceReservations.organizationId, organizationId),
              eq(resourceReservations.state, "ACTIVE"),
              eq(resourceReservations.resourceType, "ROOM"),
              inArray(
                resourceReservations.resourceId,
                rs.map((r) => r.id),
              ),
              lt(resourceReservations.startAt, to),
              gt(resourceReservations.endAt, from),
              q.excludeAppointmentId ? or(isNull(resourceReservations.appointmentId), ne(resourceReservations.appointmentId, q.excludeAppointmentId)) : undefined,
              q.excludeHoldId ? or(isNull(resourceReservations.holdId), ne(resourceReservations.holdId, q.excludeHoldId)) : undefined,
            ),
          )
      : [];
    roomList = rs.map((r) => ({ ...r, busy: busy.filter((b) => b.resourceId === r.id).map((b) => ({ start: b.start, end: b.end })) }));
  }

  return {
    siteZones,
    input: {
      blocks,
      type: q.type,
      modality: q.modality,
      practitionerBusy,
      practitionerExceptions,
      siteClosures,
      rooms: roomList,
      now: q.now,
    },
  };
}

/** Server-side slot search. Every slot carries the reasons it is offered; eligibility is POLICY_PENDING (Phase 5). */
export async function searchSlots(db: Db, ctx: AuthContext, input: unknown, now = new Date()) {
  await requireAnywhere(db, ctx, "scheduling.read", "scheduling.search", "slot");
  const q = parse(slotSearch, input);
  const type = await loadType(db, ctx.organizationId, q.appointmentTypeId);
  if (!type.active) throw new AppError("VALIDATION_FAILED", "This appointment type is inactive.", [{ code: "TYPE_INACTIVE", field: "appointmentTypeId" }]);
  if (!type.modalities.includes(q.modality))
    throw new AppError("VALIDATION_FAILED", "This appointment type is not offered with that modality.", [{ code: "MODALITY_NOT_ALLOWED", field: "modality" }]);
  const scope = siteScope(ctx, "scheduling.read");
  let siteIds: string[] | null = scope;
  if (q.siteId) {
    if (scope && !scope.includes(q.siteId)) throw notFound("Site");
    siteIds = [q.siteId];
  }
  const cands = await candidatePractitioners(db, ctx.organizationId, type, q.modality, { siteIds, practitionerId: q.practitionerId });
  const practitionerIds = [...new Set(cands.map((c) => c.id))];
  const allSiteIds = [...new Set(cands.map((c) => c.siteId))];
  const { input: avail } = await loadAvailability(db, ctx.organizationId, {
    practitionerIds,
    siteIds: allSiteIds,
    fromDate: q.fromDate,
    days: q.days,
    type,
    modality: q.modality,
    now,
  });
  // Only blocks at sites where the candidate is affiliated (templates already guarantee it, but be strict).
  const pairs = new Set(cands.map((c) => `${c.id}:${c.siteId}`));
  avail.blocks = avail.blocks.filter((b) => pairs.has(`${b.practitionerId}:${b.siteId}`));
  const slots = generateSlots({ ...avail, stepMinutes: SLOT_STEP_MINUTES, limitPerDay: q.limitPerDay });
  const names = new Map(cands.map((c) => [c.id, c.displayName]));
  return {
    appointmentType: { id: type.id, name: type.name, durationMinutes: type.durationMinutes },
    modality: q.modality,
    patientState: q.patientState ?? null,
    eligibility: {
      status: ELIGIBILITY_POLICY_PENDING,
      message: "Policy pending — license-aware eligibility is not evaluated yet (Phase 5). Synthetic demo only.",
    },
    searchedProviders: practitionerIds.length,
    slots: slots.map((s) => ({
      ...s,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      practitionerName: names.get(s.practitionerId) ?? "",
      eligibility: ELIGIBILITY_POLICY_PENDING,
    })),
  };
}
