import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@projectos/db";
import { appointmentHolds, appointmentTypes, patients, practitioners, sites, waitlistEntries, waitlistOffers } from "@projectos/db/schema";
import { can, hasAny, type AuthContext } from "@projectos/auth";
import { audit, parse } from "@projectos/core";
import { AppError, localDate, minutesOf, localTime, notFound, waitlistCreate, waitlistOffer, weekdayOf, type Modality } from "@projectos/shared";
import { assertBookingEnabled, requireAnywhere, requireAtSite, siteScope } from "./access";
import { findSlots, loadType } from "./availability";
import { createAppointment, createOfferHold, releaseHold } from "./booking";
import { eligibilityError, evaluateEligibility, persistEvaluation, type EvaluateInput } from "./eligibility";

/**
 * Waitlist (Phase 5): staff-entered requests with date/weekday/time windows. Offers hold a matching slot only
 * after a fresh eligibility evaluation, expire (hold released by the worker) and are re-evaluated again on accept.
 * Nothing is booked automatically and no patient message is sent (outbound messaging is not enabled).
 */

export async function listWaitlist(db: Db, ctx: AuthContext, q: { status?: string } = {}) {
  await requireAnywhere(db, ctx, "scheduling.read", "waitlist.list", "waitlist_entry");
  const showPatient = hasAny(ctx, "patients.read");
  const scope = siteScope(ctx, "scheduling.read");
  const entries = await db
    .select({
      e: waitlistEntries,
      patientName: patients.displayName,
      patientMrn: patients.mrn,
      typeName: appointmentTypes.name,
      siteCode: sites.code,
      practitionerName: practitioners.displayName,
    })
    .from(waitlistEntries)
    .innerJoin(patients, eq(patients.id, waitlistEntries.patientId))
    .innerJoin(appointmentTypes, eq(appointmentTypes.id, waitlistEntries.appointmentTypeId))
    .leftJoin(sites, eq(sites.id, waitlistEntries.siteId))
    .leftJoin(practitioners, eq(practitioners.id, waitlistEntries.practitionerId))
    .where(
      and(
        eq(waitlistEntries.organizationId, ctx.organizationId),
        q.status ? eq(waitlistEntries.status, q.status) : inArray(waitlistEntries.status, ["ACTIVE", "OFFERED"]),
        // Site-scoped staff see entries for their sites and site-agnostic entries.
        scope === null ? undefined : scope.length ? sql`(${waitlistEntries.siteId} is null or ${waitlistEntries.siteId} in ${scope})` : sql`${waitlistEntries.siteId} is null`,
      ),
    )
    .orderBy(asc(waitlistEntries.priority), asc(waitlistEntries.createdAt));
  const ids = entries.map((x) => x.e.id);
  const offerPrac = alias(practitioners, "offer_prac");
  const offers = ids.length
    ? await db
        .select({ o: waitlistOffers, practitionerName: offerPrac.displayName, siteCode: sites.code, timezone: sites.timezone })
        .from(waitlistOffers)
        .innerJoin(offerPrac, eq(offerPrac.id, waitlistOffers.practitionerId))
        .innerJoin(sites, eq(sites.id, waitlistOffers.siteId))
        .where(and(eq(waitlistOffers.organizationId, ctx.organizationId), inArray(waitlistOffers.entryId, ids)))
        .orderBy(desc(waitlistOffers.createdAt))
    : [];
  return entries.map(({ e, ...rest }) => ({
    ...e,
    ...rest,
    patientName: showPatient ? rest.patientName : "Patient (restricted)",
    patientMrn: showPatient ? rest.patientMrn : null,
    offers: offers.filter((o) => o.o.entryId === e.id).map(({ o, ...x }) => ({ ...o, ...x })),
  }));
}

export async function createWaitlistEntry(db: Db, ctx: AuthContext, input: unknown) {
  const d = parse(waitlistCreate, input);
  if (d.siteId) await requireAtSite(db, ctx, "scheduling.manage", d.siteId, "waitlist.create", "waitlist_entry", null);
  else await requireAnywhere(db, ctx, "scheduling.manage", "waitlist.create", "waitlist_entry");
  const [p] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.organizationId, ctx.organizationId), eq(patients.id, d.patientId)));
  if (!p) throw new AppError("VALIDATION_FAILED", "Unknown patient.", [{ code: "UNKNOWN_PATIENT", field: "patientId" }]);
  const type = await loadType(db, ctx.organizationId, d.appointmentTypeId);
  if (!type.modalities.includes(d.modality))
    throw new AppError("VALIDATION_FAILED", "This appointment type is not offered with that modality.", [{ code: "MODALITY_NOT_ALLOWED", field: "modality" }]);
  return db.transaction(async (tx) => {
    const [e] = await tx
      .insert(waitlistEntries)
      .values({
        organizationId: ctx.organizationId,
        patientId: d.patientId,
        appointmentTypeId: d.appointmentTypeId,
        modality: d.modality,
        patientLocationState: d.patientLocationState,
        payerPlanId: d.payerPlanId ?? null,
        siteId: d.siteId ?? null,
        practitionerId: d.practitionerId ?? null,
        earliestDate: d.earliestDate,
        latestDate: d.latestDate,
        weekdays: d.weekdays,
        afterTime: d.afterTime ?? null,
        beforeTime: d.beforeTime ?? null,
        priority: d.priority,
        note: d.note ?? null,
        createdBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, { action: "waitlist.create", resourceType: "waitlist_entry", resourceId: e!.id, metadata: { priority: d.priority } });
    return e!;
  });
}

async function loadEntry(db: Db, ctx: AuthContext, id: string) {
  const [e] = await db
    .select()
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.organizationId, ctx.organizationId), eq(waitlistEntries.id, id)));
  if (!e) throw notFound("Waitlist entry");
  return e;
}

export async function cancelWaitlistEntry(db: Db, ctx: AuthContext, id: string) {
  const e = await loadEntry(db, ctx, id);
  if (e.siteId) await requireAtSite(db, ctx, "scheduling.manage", e.siteId, "waitlist.cancel", "waitlist_entry", id);
  else await requireAnywhere(db, ctx, "scheduling.manage", "waitlist.cancel", "waitlist_entry");
  if (e.status === "CANCELLED" || e.status === "BOOKED") return e;
  const open = await db
    .select()
    .from(waitlistOffers)
    .where(and(eq(waitlistOffers.entryId, id), eq(waitlistOffers.status, "OFFERED")));
  for (const o of open) await respond(db, ctx, o.id, "DECLINED", "Waitlist entry cancelled");
  return db.transaction(async (tx) => {
    const [u] = await tx
      .update(waitlistEntries)
      .set({ status: "CANCELLED", version: e.version + 1 })
      .where(eq(waitlistEntries.id, id))
      .returning();
    await audit(tx, ctx, { action: "waitlist.cancel", resourceType: "waitlist_entry", resourceId: id });
    return u!;
  });
}

const fitsWindow = (e: typeof waitlistEntries.$inferSelect, date: string, start: Date, tz: string) => {
  if (date < e.earliestDate || date > e.latestDate) return false;
  if (!e.weekdays.includes(weekdayOf(date))) return false;
  const m = minutesOf(localTime(start, tz));
  if (e.afterTime && m < minutesOf(e.afterTime.slice(0, 5))) return false;
  if (e.beforeTime && m >= minutesOf(e.beforeTime.slice(0, 5))) return false;
  return true;
};

/** Eligible slots matching an entry (used to suggest offers, e.g. after a cancellation). */
export async function matchingSlots(db: Db, ctx: AuthContext, id: string, now = new Date()) {
  await requireAnywhere(db, ctx, "scheduling.read", "waitlist.match", "waitlist_entry");
  const e = await loadEntry(db, ctx, id);
  const type = await loadType(db, ctx.organizationId, e.appointmentTypeId);
  const scope = siteScope(ctx, "scheduling.read");
  const siteIds = e.siteId ? [e.siteId] : scope;
  const today = localDate(now, "America/New_York");
  const from = e.earliestDate > today ? e.earliestDate : today;
  const days = Math.min(14, Math.max(1, Math.round((Date.parse(`${e.latestDate}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1));
  if (from > e.latestDate) return [];
  const r = await findSlots(db, ctx.organizationId, {
    type,
    modality: e.modality as Modality,
    siteIds,
    practitionerId: e.practitionerId ?? undefined,
    fromDate: from,
    days,
    patientState: e.patientLocationState,
    patientLocationStatus: "PROPOSED",
    payerPlanId: e.payerPlanId,
    show: "eligible",
    limitPerDay: 40,
    now,
  });
  return r.slots.filter((s) => fitsWindow(e, s.date, new Date(s.startAt), s.timeZone));
}

/**
 * Offer a slot to a waitlisted patient: re-evaluate eligibility NOW, hold the time until the offer expires,
 * persist the evaluation. Only ALLOW results can be offered (a previously invalidated provider is never assigned).
 */
export async function offerWaitlistSlot(db: Db, ctx: AuthContext, id: string, input: unknown, now = new Date()) {
  assertBookingEnabled();
  const d = parse(waitlistOffer, input);
  const e = await loadEntry(db, ctx, id);
  // Phase 8 (privilege matrix): authorize before revealing the entry's state or searching slots for it.
  if (e.siteId) await requireAtSite(db, ctx, "scheduling.manage", e.siteId, "waitlist.offer", "waitlist_entry", id);
  else await requireAnywhere(db, ctx, "scheduling.manage", "waitlist.offer", "waitlist_entry");
  if (e.status !== "ACTIVE") throw new AppError("CONFLICT", "Only active waitlist entries can receive an offer.", [{ code: "BAD_STATUS", field: "status" }]);
  let slot: { practitionerId: string; siteId: string; startAt: string } | undefined;
  if (d.startAt && d.practitionerId && d.siteId) slot = { practitionerId: d.practitionerId, siteId: d.siteId, startAt: d.startAt };
  else slot = (await matchingSlots(db, ctx, id, now))[0];
  if (!slot) throw new AppError("SLOT_UNAVAILABLE", "No eligible open time matches this waitlist request right now.", [{ code: "NO_MATCH", field: "startAt" }]);
  await requireAtSite(db, ctx, "scheduling.manage", slot.siteId, "waitlist.offer", "waitlist_entry", id);
  const ei: EvaluateInput = {
    practitionerId: slot.practitionerId,
    siteId: slot.siteId,
    appointmentTypeId: e.appointmentTypeId,
    modality: e.modality as Modality,
    startAt: new Date(slot.startAt),
    patientLocationState: e.patientLocationState,
    patientLocationStatus: "PROPOSED",
    payerPlanId: e.payerPlanId,
  };
  const r = await evaluateEligibility(db, ctx.organizationId, ei, { capacity: null, now });
  if (r.decision !== "ALLOW") throw eligibilityError(r, " Not offered.");
  const expiresAt = new Date(now.getTime() + d.expiresInMinutes * 60_000);
  const hold = await createOfferHold(
    db,
    ctx,
    { practitionerId: slot.practitionerId, siteId: slot.siteId, appointmentTypeId: e.appointmentTypeId, modality: e.modality as Modality, startAt: slot.startAt },
    expiresAt,
    now,
  );
  return db.transaction(async (tx) => {
    const [o] = await tx
      .insert(waitlistOffers)
      .values({
        organizationId: ctx.organizationId,
        entryId: id,
        holdId: hold.id,
        practitionerId: slot.practitionerId,
        siteId: slot.siteId,
        startAt: new Date(slot.startAt),
        expiresAt,
        createdBy: ctx.userId,
      })
      .returning();
    const evalId = await persistEvaluation(tx, ctx, ei, r, { trigger: "WAITLIST_OFFER", waitlistOfferId: o!.id });
    const [withEval] = await tx.update(waitlistOffers).set({ eligibilityEvaluationId: evalId }).where(eq(waitlistOffers.id, o!.id)).returning();
    await tx
      .update(waitlistEntries)
      .set({ status: "OFFERED", version: e.version + 1 })
      .where(eq(waitlistEntries.id, id));
    await audit(tx, ctx, { action: "waitlist.offer", resourceType: "waitlist_offer", resourceId: o!.id, metadata: { entryId: id, evaluationId: evalId, holdId: hold.id } });
    return withEval!;
  });
}

async function loadOffer(db: Db, ctx: AuthContext, offerId: string) {
  const [o] = await db
    .select()
    .from(waitlistOffers)
    .where(and(eq(waitlistOffers.organizationId, ctx.organizationId), eq(waitlistOffers.id, offerId)));
  if (!o || !can(ctx, "scheduling.read", { siteId: o.siteId })) throw notFound("Offer");
  return o;
}

async function respond(db: Db, ctx: AuthContext, offerId: string, status: "DECLINED" | "INVALIDATED" | "EXPIRED", reason: string) {
  const o = await loadOffer(db, ctx, offerId);
  if (o.status !== "OFFERED") return o;
  await releaseHold(db, ctx, o.holdId, new Date(), `waitlist offer ${status.toLowerCase()}`).catch(() => undefined);
  return db.transaction(async (tx) => {
    const [u] = await tx
      .update(waitlistOffers)
      .set({ status, respondedAt: new Date(), statusReason: reason })
      .where(and(eq(waitlistOffers.id, offerId), eq(waitlistOffers.status, "OFFERED")))
      .returning();
    await tx
      .update(waitlistEntries)
      .set({ status: "ACTIVE" })
      .where(and(eq(waitlistEntries.id, o.entryId), eq(waitlistEntries.status, "OFFERED")));
    await audit(tx, ctx, { action: `waitlist.offer_${status.toLowerCase()}`, resourceType: "waitlist_offer", resourceId: offerId });
    return u ?? o;
  });
}

export async function declineWaitlistOffer(db: Db, ctx: AuthContext, offerId: string) {
  const o = await loadOffer(db, ctx, offerId);
  await requireAtSite(db, ctx, "scheduling.manage", o.siteId, "waitlist.decline", "waitlist_offer", offerId);
  return respond(db, ctx, offerId, "DECLINED", "Patient declined (recorded by staff)");
}

/**
 * Patient accepted (recorded by staff): book from the offer's hold. Eligibility is re-evaluated by the booking
 * transaction; if it no longer ALLOWs, the offer is INVALIDATED, the hold released and the entry reactivated.
 */
export async function acceptWaitlistOffer(db: Db, ctx: AuthContext, offerId: string, now = new Date()) {
  assertBookingEnabled();
  const o = await loadOffer(db, ctx, offerId);
  await requireAtSite(db, ctx, "scheduling.manage", o.siteId, "waitlist.accept", "waitlist_offer", offerId);
  if (o.status !== "OFFERED") throw new AppError("CONFLICT", `This offer is ${o.status.toLowerCase()}.`, [{ code: "BAD_STATUS", field: "status" }]);
  const [h] = await db.select().from(appointmentHolds).where(eq(appointmentHolds.id, o.holdId));
  if (!h || h.status !== "ACTIVE" || h.expiresAt <= now || o.expiresAt <= now) {
    await respond(db, ctx, offerId, "EXPIRED", "Offer expired before acceptance");
    throw new AppError("HOLD_EXPIRED", "This offer has expired; the time was released.", [{ code: "OFFER_EXPIRED", field: "offerId" }]);
  }
  const e = await loadEntry(db, ctx, o.entryId);
  try {
    const r = await createAppointment(
      db,
      ctx,
      {
        practitionerId: o.practitionerId,
        siteId: o.siteId,
        appointmentTypeId: e.appointmentTypeId,
        modality: e.modality,
        startAt: o.startAt.toISOString(),
        patientId: e.patientId,
        holdId: o.holdId,
        patientLocationState: e.patientLocationState,
        patientLocationStatus: "PROPOSED",
        payerPlanId: e.payerPlanId,
      },
      { now, allowOfferHold: true, trigger: "WAITLIST_ACCEPT", idempotencyKey: `waitlist-${offerId}` },
    );
    await db.transaction(async (tx) => {
      await tx.update(waitlistOffers).set({ status: "ACCEPTED", respondedAt: now, appointmentId: r.appointment.id }).where(eq(waitlistOffers.id, offerId));
      await tx
        .update(waitlistEntries)
        .set({ status: "BOOKED", appointmentId: r.appointment.id, version: e.version + 1 })
        .where(eq(waitlistEntries.id, e.id));
      await audit(tx, ctx, { action: "waitlist.offer_accepted", resourceType: "waitlist_offer", resourceId: offerId, metadata: { appointmentId: r.appointment.id } });
    });
    return r.appointment;
  } catch (err) {
    if (err instanceof AppError && (err.code === "ELIGIBILITY_BLOCKED" || err.code === "ELIGIBILITY_REVIEW")) {
      await respond(db, ctx, offerId, "INVALIDATED", `Eligibility changed: ${err.message}`.slice(0, 300));
    }
    throw err;
  }
}

/** Expire offers whose hold has expired (called by the worker after releasing holds). Idempotent. */
export async function expireWaitlistOffers(db: Db, now = new Date()) {
  const rows = await db.execute<{ id: string; entry_id: string; organization_id: string }>(sql`
    update waitlist_offers o set status = 'EXPIRED', responded_at = ${now.toISOString()}::timestamptz, status_reason = 'Offer expired'
    from appointment_holds h
    where o.hold_id = h.id and o.status = 'OFFERED' and (h.status <> 'ACTIVE' or o.expires_at <= ${now.toISOString()}::timestamptz)
    returning o.id, o.entry_id, o.organization_id`);
  for (const r of [...rows]) {
    await db
      .update(waitlistEntries)
      .set({ status: "ACTIVE" })
      .where(and(eq(waitlistEntries.id, r.entry_id), eq(waitlistEntries.status, "OFFERED")));
    await audit(db, { system: "scheduling.waitlist", organizationId: r.organization_id }, { action: "waitlist.offer_expired", resourceType: "waitlist_offer", resourceId: r.id });
  }
  return { expired: [...rows].length };
}

/** Active waitlist requests that could use a just-freed slot (same type; site-agnostic or same site; date in range). */
export async function waitlistCandidatesForSlot(db: Db, organizationId: string, a: { appointmentTypeId: string; siteId: string; startAt: Date; timezone: string }) {
  const date = localDate(a.startAt, a.timezone);
  const rows = await db
    .select({ id: waitlistEntries.id, weekdays: waitlistEntries.weekdays })
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.organizationId, organizationId),
        eq(waitlistEntries.status, "ACTIVE"),
        eq(waitlistEntries.appointmentTypeId, a.appointmentTypeId),
        sql`(${waitlistEntries.siteId} is null or ${waitlistEntries.siteId} = ${a.siteId})`,
        sql`${waitlistEntries.earliestDate} <= ${date}::date and ${waitlistEntries.latestDate} >= ${date}::date`,
      ),
    );
  return rows.filter((r) => r.weekdays.includes(weekdayOf(date))).length;
}
