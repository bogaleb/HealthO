import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@projectos/db";
import { appointmentTypes, payerPlans, payers, practitionerSites, practitioners, rooms, scheduleExceptions, scheduleTemplates, services, sites } from "@projectos/db/schema";
import { can, hasOrgWide, type AuthContext } from "@projectos/auth";
import { audit, authorize, mapDbError, parse } from "@projectos/core";
import { AppError, appointmentTypeCreate, appointmentTypeUpdate, notFound, roomCreate, scheduleExceptionCreate, scheduleTemplateCreate, versionConflict } from "@projectos/shared";
import { requireAtSite, siteWhere } from "./access";

/* ---------------------------------- reference ---------------------------------- */

/** Everything the scheduling pages need for pickers (scoped to sites the caller can read). */
export async function getSchedulingReference(db: Db, ctx: AuthContext) {
  const [siteRows, typeRows, provRows, roomRows, serviceRows] = await Promise.all([
    db
      .select({ id: sites.id, code: sites.code, name: sites.name, state: sites.state, timezone: sites.timezone })
      .from(sites)
      .where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.active, true), siteWhere(ctx, "scheduling.read", sites.id)))
      .orderBy(asc(sites.code)),
    db.select().from(appointmentTypes).where(eq(appointmentTypes.organizationId, ctx.organizationId)).orderBy(asc(appointmentTypes.name)),
    db
      .select({
        id: practitioners.id,
        displayName: practitioners.displayName,
        profession: practitioners.profession,
        telehealthCapable: practitioners.telehealthCapable,
        physicalState: practitioners.physicalState,
        siteIds: sql<string[]>`coalesce((select array_agg(ps.site_id::text) from ${practitionerSites} ps where ps.practitioner_id = "practitioners"."id"), '{}')`,
      })
      .from(practitioners)
      .where(and(eq(practitioners.organizationId, ctx.organizationId), eq(practitioners.active, true)))
      .orderBy(asc(practitioners.displayName)),
    db
      .select()
      .from(rooms)
      .where(and(eq(rooms.organizationId, ctx.organizationId), siteWhere(ctx, "scheduling.read", rooms.siteId)))
      .orderBy(asc(rooms.code)),
    db.select({ id: services.id, code: services.code, name: services.name }).from(services).where(eq(services.organizationId, ctx.organizationId)),
  ]);
  const plans = await db
    .select({ id: payerPlans.id, name: payerPlans.name, payerName: payers.name, requiresEnrollment: payerPlans.requiresEnrollment })
    .from(payerPlans)
    .innerJoin(payers, eq(payers.id, payerPlans.payerId))
    .where(eq(payerPlans.organizationId, ctx.organizationId))
    .orderBy(asc(payers.name), asc(payerPlans.name));
  const visibleSites = new Set(siteRows.map((s) => s.id));
  return {
    sites: siteRows,
    appointmentTypes: typeRows,
    practitioners: provRows.filter((p) => p.siteIds.some((s) => visibleSites.has(s))),
    rooms: roomRows,
    services: serviceRows,
    payerPlans: plans,
  };
}

/* ------------------------------- appointment types ------------------------------ */

async function requireConfigureOrgWide(db: Db, ctx: AuthContext, action: string) {
  if (hasOrgWide(ctx, "scheduling.configure")) return;
  await authorize(db, ctx, "scheduling.configure", {}, { action, resourceType: "appointment_type" });
}

export async function createAppointmentType(db: Db, ctx: AuthContext, input: unknown) {
  await requireConfigureOrgWide(db, ctx, "appointment_type.create");
  const d = parse(appointmentTypeCreate, input);
  try {
    return await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(appointmentTypes)
        .values({ ...d, serviceId: d.serviceId ?? null, organizationId: ctx.organizationId, createdBy: ctx.userId })
        .returning();
      await audit(tx, ctx, { action: "appointment_type.create", resourceType: "appointment_type", resourceId: r!.id, metadata: { code: d.code } });
      return r!;
    });
  } catch (e) {
    mapDbError(e, "An appointment type with this code already exists.");
  }
}

export async function updateAppointmentType(db: Db, ctx: AuthContext, id: string, input: unknown) {
  await requireConfigureOrgWide(db, ctx, "appointment_type.update");
  const { version, ...d } = parse(appointmentTypeUpdate, input);
  return db.transaction(async (tx) => {
    const [r] = await tx
      .update(appointmentTypes)
      .set({ ...d, version: version + 1 })
      .where(and(eq(appointmentTypes.organizationId, ctx.organizationId), eq(appointmentTypes.id, id), eq(appointmentTypes.version, version)))
      .returning();
    if (!r) {
      const [exists] = await tx
        .select({ id: appointmentTypes.id })
        .from(appointmentTypes)
        .where(and(eq(appointmentTypes.organizationId, ctx.organizationId), eq(appointmentTypes.id, id)));
      throw exists ? versionConflict() : notFound("Appointment type");
    }
    await audit(tx, ctx, { action: "appointment_type.update", resourceType: "appointment_type", resourceId: id, metadata: { fields: Object.keys(d) } });
    return r;
  });
}

/* ------------------------------------- rooms ------------------------------------ */

async function loadSite(db: Db, ctx: AuthContext, siteId: string) {
  const [s] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.id, siteId)));
  if (!s) throw new AppError("VALIDATION_FAILED", "Unknown site.", [{ code: "UNKNOWN_SITE", field: "siteId" }]);
  return s;
}

export async function createRoom(db: Db, ctx: AuthContext, input: unknown) {
  const d = parse(roomCreate, input);
  await loadSite(db, ctx, d.siteId);
  await requireAtSite(db, ctx, "scheduling.configure", d.siteId, "room.create");
  try {
    return await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(rooms)
        .values({ ...d, organizationId: ctx.organizationId })
        .returning();
      await audit(tx, ctx, { action: "room.create", resourceType: "room", resourceId: r!.id, metadata: { siteId: d.siteId } });
      return r!;
    });
  } catch (e) {
    mapDbError(e, "A room with this code already exists at the site.");
  }
}

/* ---------------------------------- templates ----------------------------------- */

export async function listTemplates(db: Db, ctx: AuthContext, q: { practitionerId?: string; siteId?: string } = {}) {
  return db
    .select({
      t: scheduleTemplates,
      practitionerName: practitioners.displayName,
      siteCode: sites.code,
      timezone: sites.timezone,
    })
    .from(scheduleTemplates)
    .innerJoin(practitioners, eq(practitioners.id, scheduleTemplates.practitionerId))
    .innerJoin(sites, eq(sites.id, scheduleTemplates.siteId))
    .where(
      and(
        eq(scheduleTemplates.organizationId, ctx.organizationId),
        eq(scheduleTemplates.active, true),
        siteWhere(ctx, "scheduling.read", scheduleTemplates.siteId),
        q.practitionerId ? eq(scheduleTemplates.practitionerId, q.practitionerId) : undefined,
        q.siteId ? eq(scheduleTemplates.siteId, q.siteId) : undefined,
      ),
    )
    .orderBy(asc(practitioners.displayName), asc(scheduleTemplates.weekday), asc(scheduleTemplates.startTime))
    .then((rows) => rows.map(({ t, ...rest }) => ({ ...t, ...rest })));
}

export async function createTemplate(db: Db, ctx: AuthContext, input: unknown) {
  const d = parse(scheduleTemplateCreate, input);
  await loadSite(db, ctx, d.siteId);
  await requireAtSite(db, ctx, "scheduling.configure", d.siteId, "schedule_template.create");
  const [aff] = await db
    .select({ p: practitionerSites.practitionerId })
    .from(practitionerSites)
    .where(and(eq(practitionerSites.organizationId, ctx.organizationId), eq(practitionerSites.practitionerId, d.practitionerId), eq(practitionerSites.siteId, d.siteId)));
  if (!aff) throw new AppError("VALIDATION_FAILED", "The provider is not affiliated with this site.", [{ code: "NOT_AFFILIATED", field: "siteId" }]);
  return db.transaction(async (tx) => {
    // Overlapping blocks for the same provider and weekday (any site) would double-offer the same time.
    const clash = await tx
      .select({ id: scheduleTemplates.id })
      .from(scheduleTemplates)
      .where(
        and(
          eq(scheduleTemplates.organizationId, ctx.organizationId),
          eq(scheduleTemplates.practitionerId, d.practitionerId),
          eq(scheduleTemplates.weekday, d.weekday),
          eq(scheduleTemplates.active, true),
          sql`${scheduleTemplates.startTime} < ${d.endTime}::time and ${d.startTime}::time < ${scheduleTemplates.endTime}`,
          sql`daterange(${scheduleTemplates.effectiveFrom}, coalesce(${scheduleTemplates.effectiveTo}, 'infinity'::date), '[]') && daterange(${d.effectiveFrom}::date, coalesce(${d.effectiveTo ?? null}::date, 'infinity'::date), '[]')`,
        ),
      );
    if (clash.length) throw new AppError("CONFLICT", "This provider already has working hours that overlap this block.", [{ code: "TEMPLATE_OVERLAP", field: "startTime" }]);
    const [r] = await tx
      .insert(scheduleTemplates)
      .values({ ...d, effectiveTo: d.effectiveTo ?? null, organizationId: ctx.organizationId, createdBy: ctx.userId })
      .returning();
    await audit(tx, ctx, {
      action: "schedule_template.create",
      resourceType: "schedule_template",
      resourceId: r!.id,
      metadata: { practitionerId: d.practitionerId, siteId: d.siteId },
    });
    return r!;
  });
}

/** Deactivate (history kept). Existing appointments are never touched. */
export async function deactivateTemplate(db: Db, ctx: AuthContext, id: string) {
  const [t] = await db
    .select()
    .from(scheduleTemplates)
    .where(and(eq(scheduleTemplates.organizationId, ctx.organizationId), eq(scheduleTemplates.id, id)));
  if (!t) throw notFound("Working-hours block");
  await requireAtSite(db, ctx, "scheduling.configure", t.siteId, "schedule_template.deactivate", "schedule_template", id);
  await db.transaction(async (tx) => {
    await tx
      .update(scheduleTemplates)
      .set({ active: false, version: t.version + 1 })
      .where(eq(scheduleTemplates.id, id));
    await audit(tx, ctx, { action: "schedule_template.deactivate", resourceType: "schedule_template", resourceId: id });
  });
}

/* ---------------------------------- exceptions ---------------------------------- */

export async function listExceptions(db: Db, ctx: AuthContext, q: { from: Date; to: Date }) {
  return db
    .select({
      e: scheduleExceptions,
      practitionerName: practitioners.displayName,
      siteCode: sites.code,
      impactedAppointments: sql<number>`(select count(*)::int from appointments a where a.organization_id = "schedule_exceptions"."organization_id"
        and a.status in ('PENDING','CONFIRMED') and a.start_at < "schedule_exceptions"."end_at" and a.end_at > "schedule_exceptions"."start_at"
        and (("schedule_exceptions"."kind" = 'CLOSURE' and a.site_id = "schedule_exceptions"."site_id") or ("schedule_exceptions"."kind" <> 'CLOSURE' and a.practitioner_id = "schedule_exceptions"."practitioner_id")))`,
    })
    .from(scheduleExceptions)
    .leftJoin(practitioners, eq(practitioners.id, scheduleExceptions.practitionerId))
    .leftJoin(sites, eq(sites.id, scheduleExceptions.siteId))
    .where(
      and(
        eq(scheduleExceptions.organizationId, ctx.organizationId),
        isNull(scheduleExceptions.cancelledAt),
        lte(scheduleExceptions.startAt, q.to),
        gte(scheduleExceptions.endAt, q.from),
      ),
    )
    .orderBy(asc(scheduleExceptions.startAt))
    .then((rows) => rows.map(({ e, ...rest }) => ({ ...e, ...rest })));
}

async function exceptionScopeOk(db: Db, ctx: AuthContext, kind: string, practitionerId: string | null, siteId: string | null) {
  if (kind === "CLOSURE") return siteId ? can(ctx, "scheduling.configure", { siteId }) : false;
  const ps = await db
    .select({ siteId: practitionerSites.siteId })
    .from(practitionerSites)
    .where(and(eq(practitionerSites.organizationId, ctx.organizationId), eq(practitionerSites.practitionerId, practitionerId!)));
  return can(ctx, "scheduling.configure", {}) || ps.some((p) => can(ctx, "scheduling.configure", { siteId: p.siteId }));
}

/**
 * Record PTO / closure / block. Existing appointments inside the window are NOT cancelled automatically;
 * the response lists them so a scheduling manager can review and reschedule individually.
 */
export async function createException(db: Db, ctx: AuthContext, input: unknown) {
  const d = parse(scheduleExceptionCreate, input);
  if (d.siteId) await loadSite(db, ctx, d.siteId);
  if (d.practitionerId) {
    const [p] = await db
      .select({ id: practitioners.id })
      .from(practitioners)
      .where(and(eq(practitioners.organizationId, ctx.organizationId), eq(practitioners.id, d.practitionerId)));
    if (!p) throw new AppError("VALIDATION_FAILED", "Unknown provider.", [{ code: "UNKNOWN_PRACTITIONER", field: "practitionerId" }]);
  }
  if (!(await exceptionScopeOk(db, ctx, d.kind, d.practitionerId ?? null, d.siteId ?? null))) {
    await authorize(db, ctx, "scheduling.configure", {}, { action: "schedule_exception.create", resourceType: "schedule_exception" });
  }
  const startAt = new Date(d.startAt);
  const endAt = new Date(d.endAt);
  return db.transaction(async (tx) => {
    const [r] = await tx
      .insert(scheduleExceptions)
      .values({
        organizationId: ctx.organizationId,
        kind: d.kind,
        practitionerId: d.kind === "CLOSURE" ? null : d.practitionerId!,
        siteId: d.kind === "CLOSURE" ? d.siteId! : (d.siteId ?? null),
        startAt,
        endAt,
        reason: d.reason,
        createdBy: ctx.userId,
      })
      .returning();
    const impacted = await tx.execute<{ id: string }>(sql`
      select a.id from appointments a
      where a.organization_id = ${ctx.organizationId}
        and a.status in ('PENDING','CONFIRMED')
        and a.start_at < ${endAt.toISOString()}::timestamptz and a.end_at > ${startAt.toISOString()}::timestamptz
        and ${d.kind === "CLOSURE" ? sql`a.site_id = ${d.siteId!}` : sql`a.practitioner_id = ${d.practitionerId!}`}`);
    await audit(tx, ctx, {
      action: "schedule_exception.create",
      resourceType: "schedule_exception",
      resourceId: r!.id,
      metadata: { kind: d.kind, impactedAppointments: impacted.length },
    });
    return { exception: r!, impactedAppointmentIds: [...impacted].map((x) => x.id) };
  });
}

export async function cancelException(db: Db, ctx: AuthContext, id: string) {
  const [e] = await db
    .select()
    .from(scheduleExceptions)
    .where(and(eq(scheduleExceptions.organizationId, ctx.organizationId), eq(scheduleExceptions.id, id)));
  if (!e) throw notFound("Time off / closure");
  if (!(await exceptionScopeOk(db, ctx, e.kind, e.practitionerId, e.siteId))) {
    await authorize(db, ctx, "scheduling.configure", {}, { action: "schedule_exception.cancel", resourceType: "schedule_exception", resourceId: id });
  }
  if (e.cancelledAt) return;
  await db.transaction(async (tx) => {
    await tx.update(scheduleExceptions).set({ cancelledAt: new Date(), cancelledBy: ctx.userId }).where(eq(scheduleExceptions.id, id));
    await audit(tx, ctx, { action: "schedule_exception.cancel", resourceType: "schedule_exception", resourceId: id });
  });
}
