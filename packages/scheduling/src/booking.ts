import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { pgErrorCode, type Db, type Tx } from "@projectos/db";
import { appointmentEvents, appointmentHolds, appointments, idempotencyKeys, patients, practitioners, resourceReservations, sites } from "@projectos/db/schema";
import { can, type AuthContext } from "@projectos/auth";
import { audit, parse } from "@projectos/core";
import {
  AppError,
  appointmentCancel,
  appointmentCreate,
  appointmentReschedule,
  appointmentStatusChange,
  holdCreate,
  localDate,
  notFound,
  STATUS_TRANSITIONS,
  versionConflict,
  type AppointmentStatus,
  type Modality,
  ELIGIBILITY_POLICY_PENDING,
  SLOT_STEP_MINUTES,
  localTime,
  zoneAbbreviation,
  addDays,
} from "@projectos/shared";
import { assertBookingEnabled, requireAtSite } from "./access";
import { candidatePractitioners, loadAvailability, loadType } from "./availability";
import { releaseExpiredHolds } from "./holds-job";
import { checkCandidate, generateSlots, rangesFor, UNAVAILABLE_MESSAGE } from "./slots";

export const holdMinutes = () => Math.min(Math.max(Number(process.env.SCHEDULING_HOLD_MINUTES ?? 5) || 5, 1), 30);

interface Target {
  practitionerId: string;
  siteId: string;
  appointmentTypeId: string;
  modality: Modality;
  startAt: string;
  roomId?: string | null;
}

/**
 * Re-validate a target slot INSIDE the booking transaction (never trust what the client saw):
 * type/modality, provider affiliation + service + telehealth capability, working hours, notice/horizon,
 * time off, closures, and current reservations. Overlap is ultimately enforced by the exclusion constraint.
 */
async function validateTarget(tx: Tx, ctx: AuthContext, t: Target, opts: { now: Date; excludeAppointmentId?: string; excludeHoldId?: string }) {
  const type = await loadType(tx, ctx.organizationId, t.appointmentTypeId);
  if (!type.active) throw new AppError("VALIDATION_FAILED", "This appointment type is inactive.", [{ code: "TYPE_INACTIVE", field: "appointmentTypeId" }]);
  if (!type.modalities.includes(t.modality))
    throw new AppError("VALIDATION_FAILED", "This appointment type is not offered with that modality.", [{ code: "MODALITY_NOT_ALLOWED", field: "modality" }]);
  const [site] = await tx
    .select()
    .from(sites)
    .where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.id, t.siteId)));
  if (!site || !site.active) throw new AppError("VALIDATION_FAILED", "Unknown or inactive site.", [{ code: "UNKNOWN_SITE", field: "siteId" }]);
  const cands = await candidatePractitioners(tx, ctx.organizationId, type, t.modality, { siteIds: [t.siteId], practitionerId: t.practitionerId });
  if (!cands.length)
    throw new AppError("SLOT_UNAVAILABLE", "This provider cannot take this appointment type and modality at this site.", [
      { code: "PROVIDER_NOT_ELIGIBLE_FOR_SLOT", field: "practitionerId" },
    ]);
  const start = new Date(t.startAt);
  const date = localDate(start, site.timezone);
  const { input } = await loadAvailability(tx, ctx.organizationId, {
    practitionerIds: [t.practitionerId],
    siteIds: [t.siteId],
    fromDate: addDays(date, -1),
    days: 3,
    type,
    modality: t.modality,
    now: opts.now,
    excludeAppointmentId: opts.excludeAppointmentId,
    excludeHoldId: opts.excludeHoldId,
  });
  const c = checkCandidate(input, t.practitionerId, t.siteId, start, t.roomId ?? null);
  if (!c.ok) {
    const isConflict = c.reason === "PROVIDER_BUSY" || c.reason === "NO_ROOM";
    throw new AppError(isConflict ? "SLOT_CONFLICT" : "SLOT_UNAVAILABLE", UNAVAILABLE_MESSAGE[c.reason], [{ code: c.reason, field: "startAt" }]);
  }
  const { visit, reserved } = rangesFor(type, start);
  return { type, site, roomId: c.roomId, visit, reserved, timezone: site.timezone };
}

async function reserve(
  tx: Tx,
  organizationId: string,
  res: { practitionerId: string; roomId: string | null },
  range: { start: Date; end: Date },
  owner: { kind: "APPOINTMENT"; appointmentId: string } | { kind: "HOLD"; holdId: string },
) {
  const base = {
    organizationId,
    startAt: range.start,
    endAt: range.end,
    state: "ACTIVE",
    reservationKind: owner.kind,
    appointmentId: owner.kind === "APPOINTMENT" ? owner.appointmentId : null,
    holdId: owner.kind === "HOLD" ? owner.holdId : null,
  };
  const rows = [{ ...base, resourceType: "PRACTITIONER", resourceId: res.practitionerId }];
  if (res.roomId) rows.push({ ...base, resourceType: "ROOM", resourceId: res.roomId });
  await tx.insert(resourceReservations).values(rows);
}

async function releaseFor(tx: Tx, organizationId: string, where: { appointmentId?: string; holdId?: string }, now: Date) {
  await tx
    .update(resourceReservations)
    .set({ state: "RELEASED", releasedAt: now })
    .where(
      and(
        eq(resourceReservations.organizationId, organizationId),
        eq(resourceReservations.state, "ACTIVE"),
        where.appointmentId ? eq(resourceReservations.appointmentId, where.appointmentId) : eq(resourceReservations.holdId, where.holdId!),
      ),
    );
}

/** Exclusion violation (23P01) → 409 SLOT_CONFLICT naming the resource kind, never other patients' data. */
function conflictFrom(e: unknown): AppError | null {
  if (pgErrorCode(e) !== "23P01") return null;
  const detail = String((e as { detail?: string; cause?: { detail?: string } }).detail ?? (e as { cause?: { detail?: string } }).cause?.detail ?? "");
  const room = /ROOM/.test(detail);
  return new AppError(
    "SLOT_CONFLICT",
    room ? "Cannot offer — the room is already reserved for this time." : "Cannot offer — another appointment or hold occupies this provider and time.",
    [{ code: room ? "ROOM_BUSY" : "PROVIDER_BUSY", field: "startAt" }],
  );
}

/**
 * Run a booking transaction; on an overlap, explicitly release any EXPIRED holds (audited, same as the worker)
 * and retry once — so a crashed client's stale hold never blocks forever, but an unexpired hold always wins.
 */
async function withConflictHandling<T>(db: Db, ctx: AuthContext, now: Date, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const c = conflictFrom(e) ?? (e instanceof AppError && e.code === "SLOT_CONFLICT" ? e : null);
    if (!c) throw e;
    const swept = await releaseExpiredHolds(db, { organizationId: ctx.organizationId, now });
    if (swept.released > 0) {
      try {
        return await fn();
      } catch (e2) {
        throw conflictFrom(e2) ?? e2;
      }
    }
    throw c;
  }
}

/** Up to 5 alternative starts for the same provider/type on the same and next days (shown with 409s). */
export async function alternativesFor(db: Db, ctx: AuthContext, t: Target, now = new Date()) {
  try {
    const type = await loadType(db, ctx.organizationId, t.appointmentTypeId);
    const [site] = await db
      .select()
      .from(sites)
      .where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.id, t.siteId)));
    if (!site) return [];
    const { input } = await loadAvailability(db, ctx.organizationId, {
      practitionerIds: [t.practitionerId],
      siteIds: [t.siteId],
      fromDate: localDate(new Date(t.startAt), site.timezone),
      days: 3,
      type,
      modality: t.modality,
      now,
    });
    return generateSlots({ ...input, stepMinutes: SLOT_STEP_MINUTES })
      .filter((s) => s.practitionerId === t.practitionerId && s.siteId === t.siteId)
      .slice(0, 5)
      .map((s) => ({ startAt: s.startAt.toISOString(), label: `${s.date} ${s.localStart} ${s.zone}` }));
  } catch {
    return [];
  }
}

async function attachAlternatives<T>(db: Db, ctx: AuthContext, t: Target, now: Date, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError && e.code === "SLOT_CONFLICT") {
      const alts = await alternativesFor(db, ctx, t, now);
      throw new AppError(e.code, e.message, [...e.details, ...alts.map((a) => ({ code: "ALTERNATIVE", field: a.startAt, message: a.label }))]);
    }
    throw e;
  }
}

async function event(
  tx: Tx,
  ctx: AuthContext,
  appointmentId: string,
  e: { event: string; from?: string | null; to?: string | null; reason?: string | null; before?: unknown; after?: unknown },
) {
  await tx.insert(appointmentEvents).values({
    organizationId: ctx.organizationId,
    appointmentId,
    event: e.event,
    fromStatus: e.from ?? null,
    toStatus: e.to ?? null,
    actorUserId: ctx.userId,
    reason: e.reason ?? null,
    before: (e.before ?? null) as never,
    after: (e.after ?? null) as never,
  });
}

/* ------------------------------------- holds ------------------------------------ */

export async function createHold(db: Db, ctx: AuthContext, input: unknown, now = new Date()) {
  assertBookingEnabled();
  const d = parse(holdCreate, input);
  await requireAtSite(db, ctx, "scheduling.manage", d.siteId, "appointment.hold");
  return attachAlternatives(db, ctx, d, now, () =>
    withConflictHandling(db, ctx, now, () =>
      db.transaction(async (tx) => {
        const v = await validateTarget(tx, ctx, d, { now });
        const id = randomUUID();
        const [h] = await tx
          .insert(appointmentHolds)
          .values({
            id,
            organizationId: ctx.organizationId,
            practitionerId: d.practitionerId,
            siteId: d.siteId,
            roomId: v.roomId,
            appointmentTypeId: d.appointmentTypeId,
            modality: d.modality,
            startAt: v.visit.start,
            endAt: v.visit.end,
            expiresAt: new Date(now.getTime() + holdMinutes() * 60_000),
            createdBy: ctx.userId,
          })
          .returning();
        await reserve(tx, ctx.organizationId, { practitionerId: d.practitionerId, roomId: v.roomId }, v.reserved, { kind: "HOLD", holdId: id });
        await audit(tx, ctx, { action: "hold.create", resourceType: "appointment_hold", resourceId: id, metadata: { practitionerId: d.practitionerId, siteId: d.siteId } });
        return { ...h!, timezone: v.timezone };
      }),
    ),
  );
}

export async function getHold(db: Db, ctx: AuthContext, id: string) {
  const [h] = await db
    .select({
      h: appointmentHolds,
      practitionerName: practitioners.displayName,
      siteCode: sites.code,
      siteName: sites.name,
      siteState: sites.state,
      timezone: sites.timezone,
    })
    .from(appointmentHolds)
    .innerJoin(practitioners, eq(practitioners.id, appointmentHolds.practitionerId))
    .innerJoin(sites, eq(sites.id, appointmentHolds.siteId))
    .where(and(eq(appointmentHolds.organizationId, ctx.organizationId), eq(appointmentHolds.id, id)));
  if (!h || (h.h.createdBy !== ctx.userId && !can(ctx, "scheduling.manage", { siteId: h.h.siteId }))) throw notFound("Hold");
  return { ...h.h, practitionerName: h.practitionerName, siteCode: h.siteCode, siteName: h.siteName, siteState: h.siteState, timezone: h.timezone };
}

export async function releaseHold(db: Db, ctx: AuthContext, id: string, now = new Date()) {
  const h = await getHold(db, ctx, id);
  if (h.status !== "ACTIVE") return { released: false };
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(appointmentHolds)
      .where(and(eq(appointmentHolds.id, id), eq(appointmentHolds.status, "ACTIVE")))
      .for("update");
    if (!locked) return;
    await tx.update(appointmentHolds).set({ status: "RELEASED", releasedAt: now, releaseReason: "released by staff" }).where(eq(appointmentHolds.id, id));
    await releaseFor(tx, ctx.organizationId, { holdId: id }, now);
    await audit(tx, ctx, { action: "hold.release", resourceType: "appointment_hold", resourceId: id });
  });
  return { released: true };
}

/* ------------------------------------ booking ----------------------------------- */

/**
 * Book (synthetic demo only). Idempotent with an Idempotency-Key. With `holdId` the caller's own unexpired
 * hold is converted in the same transaction. Eligibility is recorded as POLICY_PENDING — never "eligible".
 */
export async function createAppointment(db: Db, ctx: AuthContext, input: unknown, opts: { idempotencyKey?: string; now?: Date } = {}) {
  assertBookingEnabled();
  const now = opts.now ?? new Date();
  const d = parse(appointmentCreate, input);
  await requireAtSite(db, ctx, "scheduling.manage", d.siteId, "appointment.create");
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.organizationId, ctx.organizationId), eq(patients.id, d.patientId)));
  if (!patient) throw new AppError("VALIDATION_FAILED", "Unknown patient.", [{ code: "UNKNOWN_PATIENT", field: "patientId" }]);

  return attachAlternatives(db, ctx, d, now, () =>
    withConflictHandling(db, ctx, now, () =>
      db.transaction(async (tx) => {
        const newId = randomUUID();
        if (opts.idempotencyKey) {
          const inserted = await tx
            .insert(idempotencyKeys)
            .values({ organizationId: ctx.organizationId, scope: "appointment.create", key: opts.idempotencyKey, resourceId: newId })
            .onConflictDoNothing()
            .returning({ id: idempotencyKeys.id });
          if (!inserted.length) {
            const [prior] = await tx
              .select({ resourceId: idempotencyKeys.resourceId })
              .from(idempotencyKeys)
              .where(and(eq(idempotencyKeys.organizationId, ctx.organizationId), eq(idempotencyKeys.scope, "appointment.create"), eq(idempotencyKeys.key, opts.idempotencyKey)));
            const [existing] = await tx
              .select()
              .from(appointments)
              .where(and(eq(appointments.organizationId, ctx.organizationId), eq(appointments.id, prior!.resourceId)));
            if (!existing) throw new AppError("CONFLICT", "Idempotency key was already used.");
            return { appointment: existing, replayed: true };
          }
        }
        let holdId: string | undefined;
        if (d.holdId) {
          const [h] = await tx
            .select()
            .from(appointmentHolds)
            .where(and(eq(appointmentHolds.organizationId, ctx.organizationId), eq(appointmentHolds.id, d.holdId)))
            .for("update");
          if (!h || h.createdBy !== ctx.userId) throw notFound("Hold");
          if (h.status !== "ACTIVE" || h.expiresAt <= now)
            throw new AppError("HOLD_EXPIRED", "This hold has expired or was released. Search again.", [{ code: "HOLD_EXPIRED", field: "holdId" }]);
          const same =
            h.practitionerId === d.practitionerId &&
            h.siteId === d.siteId &&
            h.appointmentTypeId === d.appointmentTypeId &&
            h.modality === d.modality &&
            h.startAt.getTime() === new Date(d.startAt).getTime();
          if (!same) throw new AppError("VALIDATION_FAILED", "The booking does not match the held slot.", [{ code: "HOLD_MISMATCH", field: "holdId" }]);
          await tx.update(appointmentHolds).set({ status: "CONVERTED", releasedAt: now, releaseReason: "converted to appointment" }).where(eq(appointmentHolds.id, h.id));
          await releaseFor(tx, ctx.organizationId, { holdId: h.id }, now);
          holdId = h.id;
          if (!d.roomId && h.roomId) d.roomId = h.roomId;
        }
        const v = await validateTarget(tx, ctx, d, { now, excludeHoldId: holdId });
        const [p] = await tx.select({ physicalState: practitioners.physicalState }).from(practitioners).where(eq(practitioners.id, d.practitionerId));
        const [a] = await tx
          .insert(appointments)
          .values({
            id: newId,
            organizationId: ctx.organizationId,
            patientId: d.patientId,
            practitionerId: d.practitionerId,
            siteId: d.siteId,
            roomId: v.roomId,
            appointmentTypeId: d.appointmentTypeId,
            modality: d.modality,
            startAt: v.visit.start,
            endAt: v.visit.end,
            reservedStartAt: v.reserved.start,
            reservedEndAt: v.reserved.end,
            timezone: v.timezone,
            status: "CONFIRMED",
            patientLocationState: d.patientLocationState,
            patientLocationStatus: d.patientLocationStatus,
            providerLocationState: d.modality === "IN_PERSON" ? v.site.state : (p?.physicalState ?? null),
            eligibilityStatus: ELIGIBILITY_POLICY_PENDING,
            holdId: holdId ?? null,
            createdBy: ctx.userId,
          })
          .returning();
        await reserve(tx, ctx.organizationId, { practitionerId: d.practitionerId, roomId: v.roomId }, v.reserved, { kind: "APPOINTMENT", appointmentId: newId });
        await event(tx, ctx, newId, { event: "BOOKED", to: "CONFIRMED", after: { startAt: a!.startAt, practitionerId: d.practitionerId, siteId: d.siteId, roomId: v.roomId } });
        await audit(tx, ctx, {
          action: "appointment.create",
          resourceType: "appointment",
          resourceId: newId,
          metadata: { practitionerId: d.practitionerId, siteId: d.siteId, fromHold: !!holdId, eligibility: ELIGIBILITY_POLICY_PENDING },
        });
        return { appointment: a!, replayed: false };
      }),
    ),
  );
}

async function lockAppointment(tx: Tx, ctx: AuthContext, id: string) {
  const [a] = await tx
    .select()
    .from(appointments)
    .where(and(eq(appointments.organizationId, ctx.organizationId), eq(appointments.id, id)))
    .for("update");
  if (!a) throw notFound("Appointment");
  return a;
}

async function loadForAuth(db: Db, ctx: AuthContext, id: string, action: string) {
  const [a] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.organizationId, ctx.organizationId), eq(appointments.id, id)));
  if (!a || !can(ctx, "scheduling.read", { siteId: a.siteId })) throw notFound("Appointment");
  await requireAtSite(db, ctx, "scheduling.manage", a.siteId, action, "appointment", id);
  return a;
}

const snapshot = (a: typeof appointments.$inferSelect) => ({
  startAt: a.startAt,
  endAt: a.endAt,
  practitionerId: a.practitionerId,
  siteId: a.siteId,
  roomId: a.roomId,
  status: a.status,
});

/**
 * Atomic reschedule: release the old reservations and create the new ones in ONE transaction. If anything
 * fails (conflict, closed, outside hours, version) the transaction rolls back and the original is unchanged.
 */
export async function rescheduleAppointment(db: Db, ctx: AuthContext, id: string, input: unknown, now = new Date()) {
  assertBookingEnabled();
  const d = parse(appointmentReschedule, input);
  const cur = await loadForAuth(db, ctx, id, "appointment.reschedule");
  const target: Target = {
    practitionerId: d.practitionerId ?? cur.practitionerId,
    siteId: d.siteId ?? cur.siteId,
    appointmentTypeId: cur.appointmentTypeId,
    modality: cur.modality as Modality,
    startAt: d.startAt,
    roomId: d.roomId === undefined ? (d.siteId && d.siteId !== cur.siteId ? null : cur.roomId) : d.roomId,
  };
  if (target.siteId !== cur.siteId) await requireAtSite(db, ctx, "scheduling.manage", target.siteId, "appointment.reschedule", "appointment", id);
  return attachAlternatives(db, ctx, target, now, () =>
    withConflictHandling(db, ctx, now, () =>
      db.transaction(async (tx) => {
        const a = await lockAppointment(tx, ctx, id);
        if (a.version !== d.version) throw versionConflict();
        if (!["PENDING", "CONFIRMED", "NEEDS_RESCHEDULE"].includes(a.status))
          throw new AppError("CONFLICT", `A ${a.status.toLowerCase().replace("_", " ")} appointment cannot be rescheduled.`, [{ code: "BAD_STATUS", field: "status" }]);
        await releaseFor(tx, ctx.organizationId, { appointmentId: id }, now);
        const v = await validateTarget(tx, ctx, target, { now, excludeAppointmentId: id });
        const [u] = await tx
          .update(appointments)
          .set({
            practitionerId: target.practitionerId,
            siteId: target.siteId,
            roomId: v.roomId,
            startAt: v.visit.start,
            endAt: v.visit.end,
            reservedStartAt: v.reserved.start,
            reservedEndAt: v.reserved.end,
            timezone: v.timezone,
            status: "CONFIRMED",
            version: a.version + 1,
          })
          .where(eq(appointments.id, id))
          .returning();
        await reserve(tx, ctx.organizationId, { practitionerId: target.practitionerId, roomId: v.roomId }, v.reserved, { kind: "APPOINTMENT", appointmentId: id });
        await event(tx, ctx, id, { event: "RESCHEDULED", from: a.status, to: "CONFIRMED", reason: d.reason, before: snapshot(a), after: snapshot(u!) });
        await audit(tx, ctx, { action: "appointment.reschedule", resourceType: "appointment", resourceId: id, metadata: { movedSite: target.siteId !== a.siteId } });
        return u!;
      }),
    ),
  );
}

export async function cancelAppointment(db: Db, ctx: AuthContext, id: string, input: unknown, now = new Date()) {
  const d = parse(appointmentCancel, input);
  await loadForAuth(db, ctx, id, "appointment.cancel");
  return db.transaction(async (tx) => {
    const a = await lockAppointment(tx, ctx, id);
    if (a.status === "CANCELLED") return a; // idempotent retry
    if (a.version !== d.version) throw versionConflict();
    if (!["PENDING", "CONFIRMED", "NEEDS_RESCHEDULE"].includes(a.status))
      throw new AppError("CONFLICT", "Only booked appointments can be cancelled.", [{ code: "BAD_STATUS", field: "status" }]);
    const [u] = await tx
      .update(appointments)
      .set({ status: "CANCELLED", cancelReason: d.reason, version: a.version + 1 })
      .where(eq(appointments.id, id))
      .returning();
    await releaseFor(tx, ctx.organizationId, { appointmentId: id }, now);
    await event(tx, ctx, id, { event: "CANCELLED", from: a.status, to: "CANCELLED", reason: d.reason });
    await audit(tx, ctx, { action: "appointment.cancel", resourceType: "appointment", resourceId: id });
    return u!;
  });
}

/** Check-in / complete / no-show. Check-in only on the visit's local date; no-show only after the start. */
export async function changeAppointmentStatus(db: Db, ctx: AuthContext, id: string, input: unknown, now = new Date()) {
  const d = parse(appointmentStatusChange, input);
  await loadForAuth(db, ctx, id, "appointment.status");
  return db.transaction(async (tx) => {
    const a = await lockAppointment(tx, ctx, id);
    if (a.status === d.status) return a;
    if (a.version !== d.version) throw versionConflict();
    const allowed = STATUS_TRANSITIONS[a.status as AppointmentStatus] ?? [];
    if (!allowed.includes(d.status)) throw new AppError("CONFLICT", `Cannot change an appointment from ${a.status} to ${d.status}.`, [{ code: "BAD_TRANSITION", field: "status" }]);
    if (d.status === "CHECKED_IN" && localDate(now, a.timezone) !== localDate(a.startAt, a.timezone))
      throw new AppError("CONFLICT", "Check-in is only possible on the day of the visit.", [{ code: "NOT_VISIT_DAY", field: "status" }]);
    if (d.status === "NO_SHOW" && now < a.startAt) throw new AppError("CONFLICT", "A visit cannot be marked no-show before it starts.", [{ code: "NOT_STARTED", field: "status" }]);
    const [u] = await tx
      .update(appointments)
      .set({ status: d.status, version: a.version + 1 })
      .where(eq(appointments.id, id))
      .returning();
    await event(tx, ctx, id, { event: d.status, from: a.status, to: d.status, reason: d.reason ?? null });
    await audit(tx, ctx, { action: "appointment.status", resourceType: "appointment", resourceId: id, metadata: { from: a.status, to: d.status } });
    return u!;
  });
}

/** Human-readable local label with explicit zone (used in API responses and the UI). */
export const localLabel = (d: Date, tz: string) => `${localDate(d, tz)} ${localTime(d, tz)} ${zoneAbbreviation(d, tz)}`;
