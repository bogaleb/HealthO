import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@projectos/db";
import {
  appointmentEvents,
  appointments,
  ehrAppointmentLinks,
  ehrConnections,
  ehrResourceLinks,
  ehrSimResources,
  integrationConflicts,
  integrationSyncRuns,
  outboxEvents,
  patients,
  practitionerSites,
  practitioners,
  scheduleExceptions,
  sites,
} from "@projectos/db/schema";
import { hasAny, type AuthContext } from "@projectos/auth";
import { audit, authorize, parse } from "@projectos/core";
import { OUTBOX_HANDLERS, PermanentDeliveryError, enqueueOutbox, type OutboxRow } from "@projectos/notifications";
import { EHR_WRITE, cancelAppointment, queueEhrWrite, type EhrOp } from "@projectos/scheduling";
import { AppError, notFound } from "@projectos/shared";
import { z } from "zod";
import {
  EHR_CAPABILITIES,
  EhrRejectedError,
  EhrUnavailableError,
  EhrVersionConflictError,
  PROJECTOS_IDENTIFIER_SYSTEM,
  UnverifiedVendorAdapter,
  parseCapabilities,
  requireCapability,
  usable,
  type CapabilityFlags,
  type EhrSchedulingAdapter,
  type FhirAppointment,
} from "./adapter";
import {
  SIM_FAILURE_MODES,
  SyntheticEhrSimulator,
  setSimFailureMode,
  simulateEhrSideBooking,
  simulateEhrSideChange,
  simulatorCapabilities,
  type SimFailureMode,
} from "./simulator";

type Conn = typeof ehrConnections.$inferSelect;

// ------------------------------------------------------------------ adapter resolution

export async function locationExternalId(db: DbOrTx, conn: Conn) {
  const [l] = await db
    .select({ ext: ehrResourceLinks.externalId })
    .from(ehrResourceLinks)
    .where(and(eq(ehrResourceLinks.connectionId, conn.id), eq(ehrResourceLinks.kind, "LOCATION"), eq(ehrResourceLinks.localId, conn.siteId)));
  return l?.ext ?? null;
}

/** Stored capability flags are the source of truth for what ProjectOS may use (supported ∧ verified). */
export function effectiveCapabilities(conn: Conn, adapter: EhrSchedulingAdapter): CapabilityFlags {
  const stored = parseCapabilities(conn.capabilities);
  for (const c of EHR_CAPABILITIES) if (!adapter.capabilities[c].supported) stored[c] = { supported: false, verified: false, verifiedBy: null };
  return stored;
}

export async function adapterFor(db: Db, conn: Conn): Promise<{ adapter: EhrSchedulingAdapter; caps: CapabilityFlags }> {
  if (conn.vendor === "SYNTHETIC_SIMULATOR") {
    const loc = await locationExternalId(db, conn);
    if (!loc) {
      const a = new UnverifiedVendorAdapter();
      return { adapter: a, caps: a.capabilities };
    }
    const a = new SyntheticEhrSimulator(db, conn.id, loc);
    return { adapter: a, caps: effectiveCapabilities(conn, a) };
  }
  const a = new UnverifiedVendorAdapter();
  return { adapter: a, caps: a.capabilities };
}

async function loadConn(db: DbOrTx, organizationId: string, id: string) {
  const [c] = await db
    .select()
    .from(ehrConnections)
    .where(and(eq(ehrConnections.organizationId, organizationId), eq(ehrConnections.id, id)));
  if (!c) throw notFound("EHR connection");
  return c;
}

async function connForSite(db: DbOrTx, organizationId: string, siteId: string) {
  const [c] = await db
    .select()
    .from(ehrConnections)
    .where(and(eq(ehrConnections.organizationId, organizationId), eq(ehrConnections.siteId, siteId)));
  return c ?? null;
}

async function recordRun(db: Db, conn: Conn, kind: "HEALTH" | "AVAILABILITY" | "CHANGES" | "RECONCILE", startedAt: Date, r: { ok: boolean; stats?: object; error?: string }) {
  await db.insert(integrationSyncRuns).values({
    organizationId: conn.organizationId,
    connectionId: conn.id,
    kind,
    status: r.ok ? "OK" : "FAILED",
    startedAt,
    finishedAt: new Date(),
    stats: r.stats ?? {},
    error: r.error?.slice(0, 300) ?? null,
  });
  await db
    .update(ehrConnections)
    .set(r.ok ? { lastSuccessAt: new Date() } : { lastErrorAt: new Date(), lastError: `${kind}: ${r.error?.slice(0, 280) ?? "failed"}` })
    .where(eq(ehrConnections.id, conn.id));
}

/** Upsert a conflict (deduped); conflicts are never auto-resolved silently. */
async function raiseConflict(
  db: DbOrTx,
  conn: { id: string; organizationId: string },
  c: { kind: string; appointmentId?: string | null; externalId?: string | null; detail: string; dedupeKey: string },
) {
  await db
    .insert(integrationConflicts)
    .values({
      organizationId: conn.organizationId,
      connectionId: conn.id,
      kind: c.kind,
      appointmentId: c.appointmentId ?? null,
      externalId: c.externalId ?? null,
      detail: c.detail.slice(0, 400),
      dedupeKey: c.dedupeKey,
    })
    .onConflictDoNothing();
}

async function systemEvent(db: DbOrTx, organizationId: string, appointmentId: string, e: { event: string; from?: string | null; to?: string | null; reason: string }) {
  await db.insert(appointmentEvents).values({
    organizationId,
    appointmentId,
    event: e.event,
    fromStatus: e.from ?? null,
    toStatus: e.to ?? null,
    actorSystem: "integrations.ehr",
    reason: e.reason,
  });
}

// ------------------------------------------------------------------ health + availability + changes

export async function runHealthCheck(db: Db, conn: Conn) {
  const started = new Date();
  const { adapter } = await adapterFor(db, conn);
  let h: { ok: boolean; latencyMs: number; detail: string };
  try {
    h = await adapter.health();
  } catch (e) {
    h = { ok: false, latencyMs: 0, detail: e instanceof Error ? e.message : "health check failed" };
  }
  await db.update(ehrConnections).set({ lastHealthAt: new Date(), lastHealthOk: h.ok }).where(eq(ehrConnections.id, conn.id));
  await recordRun(db, conn, "HEALTH", started, { ok: h.ok, stats: { latencyMs: h.latencyMs, detail: h.detail }, error: h.ok ? undefined : h.detail });
  return h;
}

/**
 * Availability sync: busy times that exist only in the EHR (booked there by other staff) become BLOCK exceptions
 * (`external_ref`) so ProjectOS never offers those times. Success refreshes the site's freshness timestamp; failure
 * leaves it — the site then becomes stale and booking fails closed (draft only).
 */
export async function syncAvailability(db: Db, conn: Conn, now = new Date(), days = 21) {
  const started = new Date();
  const { adapter, caps } = await adapterFor(db, conn);
  try {
    requireCapability(caps, "getAvailability");
    const blocks = await adapter.getAvailability({ from: new Date(now.getTime() - 86_400_000), to: new Date(now.getTime() + days * 86_400_000) });
    const pracLinks = await db
      .select({ local: ehrResourceLinks.localId, ext: ehrResourceLinks.externalId })
      .from(ehrResourceLinks)
      .where(and(eq(ehrResourceLinks.connectionId, conn.id), eq(ehrResourceLinks.kind, "PRACTITIONER")));
    const pracOf = new Map(pracLinks.map((l) => [`Practitioner/${l.ext}`, l.local]));
    const ours = new Set(
      (await db.select({ ext: ehrAppointmentLinks.externalId }).from(ehrAppointmentLinks).where(eq(ehrAppointmentLinks.connectionId, conn.id))).map((r) => r.ext),
    );
    let imported = 0;
    let removed = 0;
    let unmapped = 0;
    const seen = new Set<string>();
    for (const b of blocks) {
      if (ours.has(b.externalId) || b.origin === "PROJECTOS") continue; // our own bookings already reserve their time
      const ref = `${conn.id}:${b.externalId}`;
      seen.add(ref);
      const practitionerId = pracOf.get(b.practitionerRef);
      if (!practitionerId) {
        unmapped++;
        await raiseConflict(db, conn, {
          kind: "UNMAPPED_RESOURCE",
          externalId: b.externalId,
          detail: `EHR busy time for an unmapped practitioner (${b.practitionerRef}); it is not blocked in ProjectOS until mapped.`,
          dedupeKey: `unmapped:${conn.id}:${b.practitionerRef}`,
        });
        continue;
      }
      const [ex] = await db
        .select()
        .from(scheduleExceptions)
        .where(and(eq(scheduleExceptions.organizationId, conn.organizationId), eq(scheduleExceptions.externalRef, ref)));
      if (b.status === "cancelled") {
        if (ex && !ex.cancelledAt) {
          await db.update(scheduleExceptions).set({ cancelledAt: now }).where(eq(scheduleExceptions.id, ex.id));
          removed++;
        }
        continue;
      }
      if (!ex) {
        await db.insert(scheduleExceptions).values({
          organizationId: conn.organizationId,
          kind: "BLOCK",
          practitionerId,
          siteId: conn.siteId,
          startAt: b.start,
          endAt: b.end,
          reason: "Busy in EHR (synced)",
          externalRef: ref,
        });
        imported++;
      } else if (ex.startAt.getTime() !== b.start.getTime() || ex.endAt.getTime() !== b.end.getTime() || ex.cancelledAt) {
        await db.update(scheduleExceptions).set({ startAt: b.start, endAt: b.end, cancelledAt: null }).where(eq(scheduleExceptions.id, ex.id));
        imported++;
      }
    }
    // EHR busy blocks that disappeared from the window are released.
    const stale = await db
      .select({ id: scheduleExceptions.id, ref: scheduleExceptions.externalRef })
      .from(scheduleExceptions)
      .where(
        and(
          eq(scheduleExceptions.organizationId, conn.organizationId),
          sql`${scheduleExceptions.externalRef} like ${`${conn.id}:%`}`,
          isNull(scheduleExceptions.cancelledAt),
          gt(scheduleExceptions.endAt, now),
        ),
      );
    for (const s of stale)
      if (!seen.has(s.ref!)) {
        await db.update(scheduleExceptions).set({ cancelledAt: now }).where(eq(scheduleExceptions.id, s.id));
        removed++;
      }
    await db.update(sites).set({ ehrLastSyncedAt: now }).where(eq(sites.id, conn.siteId));
    const stats = { busyBlocks: blocks.length, imported, removed, unmapped };
    await recordRun(db, conn, "AVAILABILITY", started, { ok: true, stats });
    return { ok: true as const, ...stats };
  } catch (e) {
    const error = e instanceof Error ? e.message : "availability sync failed";
    await recordRun(db, conn, "AVAILABILITY", started, { ok: false, error });
    return { ok: false as const, error };
  }
}

/**
 * Change feed: an appointment ProjectOS created was cancelled or moved directly in the EHR. The EHR is the master,
 * so the local booking is taken out of the routine flow (NEEDS_RESCHEDULE) and a conflict is raised for staff.
 */
export async function pullEhrChanges(db: Db, conn: Conn) {
  const started = new Date();
  const { adapter, caps } = await adapterFor(db, conn);
  try {
    requireCapability(caps, "pullChanges");
    const { changes, cursor } = await adapter.pullChanges(conn.changesCursor);
    let conflicts = 0;
    for (const ch of changes) {
      if (!ch.id) continue;
      const [link] = await db
        .select()
        .from(ehrAppointmentLinks)
        .where(and(eq(ehrAppointmentLinks.connectionId, conn.id), eq(ehrAppointmentLinks.externalId, ch.id)));
      if (!link || link.etag === ch.etag) continue; // not ours, or our own write
      conflicts += await compareWithLocal(db, conn, link, ch);
    }
    await db.update(ehrConnections).set({ changesCursor: cursor }).where(eq(ehrConnections.id, conn.id));
    const stats = { changes: changes.length, conflicts };
    await recordRun(db, conn, "CHANGES", started, { ok: true, stats });
    return { ok: true as const, ...stats };
  } catch (e) {
    const error = e instanceof Error ? e.message : "change pull failed";
    await recordRun(db, conn, "CHANGES", started, { ok: false, error });
    return { ok: false as const, error };
  }
}

/** Compare the EHR's version with ours; returns 1 if a conflict was raised. */
async function compareWithLocal(db: Db, conn: Conn, link: typeof ehrAppointmentLinks.$inferSelect, ext: FhirAppointment & { etag: string }) {
  const [a] = await db.select().from(appointments).where(eq(appointments.id, link.appointmentId));
  if (!a) return 0;
  const cancelledThere = ext.status === "cancelled";
  const moved = new Date(ext.start).getTime() !== a.startAt.getTime() || new Date(ext.end).getTime() !== a.endAt.getTime();
  if (cancelledThere && a.status === "CANCELLED") {
    await db.update(ehrAppointmentLinks).set({ etag: ext.etag, externalStatus: "cancelled", lastSyncedAt: new Date() }).where(eq(ehrAppointmentLinks.id, link.id));
    return 0;
  }
  if (!cancelledThere && !moved) {
    await db.update(ehrAppointmentLinks).set({ etag: ext.etag, externalStatus: ext.status, lastSyncedAt: new Date() }).where(eq(ehrAppointmentLinks.id, link.id));
    return 0;
  }
  const kind = cancelledThere ? "EXTERNAL_CANCELLED" : "EXTERNAL_CHANGED";
  await db.transaction(async (tx) => {
    await tx.update(ehrAppointmentLinks).set({ etag: ext.etag, externalStatus: ext.status, lastSyncedAt: new Date() }).where(eq(ehrAppointmentLinks.id, link.id));
    if (["PENDING", "CONFIRMED"].includes(a.status)) {
      await tx
        .update(appointments)
        .set({ status: "NEEDS_RESCHEDULE", ehrState: "CONFLICT", version: a.version + 1 })
        .where(eq(appointments.id, a.id));
      await systemEvent(tx, a.organizationId, a.id, {
        event: "EHR_CONFLICT",
        from: a.status,
        to: "NEEDS_RESCHEDULE",
        reason: cancelledThere ? "Cancelled directly in the EHR (master schedule)" : "Time changed directly in the EHR (master schedule)",
      });
    } else {
      await tx.update(appointments).set({ ehrState: "CONFLICT" }).where(eq(appointments.id, a.id));
    }
    await raiseConflict(tx, conn, {
      kind,
      appointmentId: a.id,
      externalId: link.externalId,
      detail: cancelledThere
        ? "The EHR shows this appointment as cancelled. Accept the EHR (cancel here) or rebook."
        : `The EHR moved this appointment to ${ext.start}. Reschedule here to match, then mark resolved.`,
      dedupeKey: `${kind.toLowerCase()}:${link.externalId}:${ext.etag}`,
    });
  });
  return 1;
}

/**
 * Reconciliation: every mapping is compared with the EHR; sent-but-unconfirmed bookings with no live outbox row are
 * re-queued (repair); missing remote records are reported. Idempotent — conflicts are deduplicated.
 */
export async function reconcileConnection(db: Db, conn: Conn, now = new Date()) {
  const started = new Date();
  const { adapter, caps } = await adapterFor(db, conn);
  try {
    requireCapability(caps, "getAppointmentByExternalId");
    const links = await db.select().from(ehrAppointmentLinks).where(eq(ehrAppointmentLinks.connectionId, conn.id));
    let checked = 0;
    let conflicts = 0;
    let missing = 0;
    for (const link of links) {
      checked++;
      const ext = await adapter.getAppointmentByExternalId(link.externalId);
      if (!ext) {
        missing++;
        await raiseConflict(db, conn, {
          kind: "MISSING_EXTERNAL",
          appointmentId: link.appointmentId,
          externalId: link.externalId,
          detail: "Mapped appointment no longer exists in the EHR.",
          dedupeKey: `missing:${link.externalId}`,
        });
        await db
          .update(appointments)
          .set({ ehrState: "CONFLICT" })
          .where(and(eq(appointments.id, link.appointmentId), sql`${appointments.ehrState} <> 'CONFLICT'`));
        continue;
      }
      if (ext.etag !== link.etag) conflicts += await compareWithLocal(db, conn, link, ext);
    }
    // Repair: sent / failed writes whose outbox row is gone or DEAD-and-replayed get a fresh outbox row.
    const stuck = await db
      .select({ id: appointments.id, version: appointments.version, ehrState: appointments.ehrState, status: appointments.status })
      .from(appointments)
      .where(
        and(
          eq(appointments.organizationId, conn.organizationId),
          eq(appointments.siteId, conn.siteId),
          inArray(appointments.ehrState, ["PENDING_CREATE", "PENDING_UPDATE", "PENDING_CANCEL"]),
          lt(appointments.updatedAt, new Date(now.getTime() - 15 * 60_000)),
        ),
      );
    let requeued = 0;
    for (const a of stuck) {
      const [live] = await db
        .select({ id: outboxEvents.id })
        .from(outboxEvents)
        .where(and(eq(outboxEvents.type, EHR_WRITE), sql`${outboxEvents.payload}->>'appointmentId' = ${a.id}`, inArray(outboxEvents.status, ["PENDING", "PROCESSING", "FAILED"])));
      if (live) continue;
      const op: EhrOp = a.ehrState === "PENDING_CANCEL" ? "CANCEL" : a.ehrState === "PENDING_UPDATE" ? "UPDATE" : "CREATE";
      if (await queueEhrWrite(db, conn.organizationId, a.id, op, a.version)) requeued++;
    }
    const stats = { checked, conflicts, missing, requeued };
    await recordRun(db, conn, "RECONCILE", started, { ok: true, stats });
    return { ok: true as const, ...stats };
  } catch (e) {
    const error = e instanceof Error ? e.message : "reconciliation failed";
    await recordRun(db, conn, "RECONCILE", started, { ok: false, error });
    return { ok: false as const, error };
  }
}

/** Worker job: health → availability → change feed for every enabled connection at an EHR-backed site. */
export async function syncAllConnections(db: Db, opts: { organizationId?: string; now?: Date } = {}) {
  const conns = await db
    .select({ c: ehrConnections })
    .from(ehrConnections)
    .innerJoin(sites, eq(sites.id, ehrConnections.siteId))
    .where(
      and(
        eq(ehrConnections.enabled, true),
        inArray(sites.ehrSyncMode, ["EHR_MASTER", "READ_ONLY"]),
        opts.organizationId ? eq(ehrConnections.organizationId, opts.organizationId) : undefined,
      ),
    );
  const out: Record<string, unknown>[] = [];
  for (const { c } of conns) {
    const h = await runHealthCheck(db, c);
    if (!h.ok) {
      out.push({ connectionId: c.id, health: false });
      continue;
    }
    const fresh = (await loadConn(db, c.organizationId, c.id))!;
    out.push({ connectionId: c.id, availability: await syncAvailability(db, fresh, opts.now), changes: await pullEhrChanges(db, fresh) });
  }
  return { connections: conns.length, results: out };
}

export async function reconcileAll(db: Db, opts: { organizationId?: string; now?: Date } = {}) {
  const conns = await db
    .select()
    .from(ehrConnections)
    .where(and(eq(ehrConnections.enabled, true), opts.organizationId ? eq(ehrConnections.organizationId, opts.organizationId) : undefined));
  const out = [];
  for (const c of conns) out.push({ connectionId: c.id, ...(await reconcileConnection(db, c, opts.now)) });
  return out;
}

// ------------------------------------------------------------------ outbox delivery: ehr.write

/** Patient identifier mapping: exact match on the synthetic MRN; none or several → conflict, never a guess. */
async function patientRef(db: Db, conn: Conn, adapter: EhrSchedulingAdapter, caps: CapabilityFlags, patientId: string, appointmentId: string) {
  const [link] = await db
    .select({ ext: ehrResourceLinks.externalId })
    .from(ehrResourceLinks)
    .where(and(eq(ehrResourceLinks.connectionId, conn.id), eq(ehrResourceLinks.kind, "PATIENT"), eq(ehrResourceLinks.localId, patientId)));
  if (link) return `Patient/${link.ext}`;
  requireCapability(caps, "searchPatients");
  const [p] = await db.select({ mrn: patients.mrn }).from(patients).where(eq(patients.id, patientId));
  const matches = await adapter.searchPatients({ identifier: p!.mrn });
  if (matches.length !== 1) {
    const kind = matches.length ? "PATIENT_AMBIGUOUS" : "PATIENT_NOT_FOUND";
    await raiseConflict(db, conn, {
      kind,
      appointmentId,
      detail: matches.length
        ? `${matches.length} EHR patients share this patient's identifier; choose the right one in the EHR (no automatic match).`
        : "No EHR patient has this patient's identifier. Register or merge the patient in the EHR, then retry.",
      dedupeKey: `${kind.toLowerCase()}:${conn.id}:${patientId}`,
    });
    throw new PermanentDeliveryError(kind);
  }
  await db
    .insert(ehrResourceLinks)
    .values({ organizationId: conn.organizationId, connectionId: conn.id, kind: "PATIENT", localId: patientId, externalId: matches[0]!.externalId, matchedBy: "IDENTIFIER_EXACT" })
    .onConflictDoNothing();
  return `Patient/${matches[0]!.externalId}`;
}

async function practitionerRef(db: Db, conn: Conn, practitionerId: string) {
  const [l] = await db
    .select({ ext: ehrResourceLinks.externalId })
    .from(ehrResourceLinks)
    .where(and(eq(ehrResourceLinks.connectionId, conn.id), eq(ehrResourceLinks.kind, "PRACTITIONER"), eq(ehrResourceLinks.localId, practitionerId)));
  return l ? `Practitioner/${l.ext}` : null;
}

export function toFhirAppointment(
  a: { id: string; startAt: Date; endAt: Date },
  refs: { patient: string; practitioner: string; location: string },
  status: "booked" | "cancelled" = "booked",
): FhirAppointment {
  return {
    resourceType: "Appointment",
    status,
    start: a.startAt.toISOString(),
    end: a.endAt.toISOString(),
    participant: [
      { actor: { reference: refs.patient }, status: "accepted" },
      { actor: { reference: refs.practitioner }, status: "accepted" },
      { actor: { reference: refs.location }, status: "accepted" },
    ],
    identifier: [{ system: PROJECTOS_IDENTIFIER_SYSTEM, value: a.id }],
  };
}

const writeFailure = (e: unknown) => {
  if (e instanceof EhrUnavailableError) return e; // retry with backoff
  if (e instanceof PermanentDeliveryError) return e;
  if (e instanceof EhrRejectedError || e instanceof EhrVersionConflictError) return new PermanentDeliveryError(e.message);
  if (e instanceof Error && e.name === "CapabilityNotVerifiedError") return new PermanentDeliveryError(e.message);
  return e;
};

/**
 * Deliver one `ehr.write`. Exactly-once in the EHR: the create uses a stable idempotency key per appointment, so a
 * retry after a timeout returns the original EHR appointment; the mapping row is unique per appointment.
 */
export async function deliverEhrWrite(db: Db, ev: OutboxRow) {
  const { appointmentId, op } = ev.payload as { appointmentId: string; op: EhrOp };
  const [a] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.organizationId, ev.organizationId), eq(appointments.id, appointmentId)));
  if (!a) throw new PermanentDeliveryError("Appointment not found");
  const conn = await connForSite(db, a.organizationId, a.siteId);
  if (!conn || !conn.enabled) throw new PermanentDeliveryError("No enabled EHR connection for this site");
  const { adapter, caps } = await adapterFor(db, conn);
  const [link] = await db.select().from(ehrAppointmentLinks).where(eq(ehrAppointmentLinks.appointmentId, a.id));
  try {
    if (op === "CREATE" || (op === "UPDATE" && !link)) {
      if (a.status === "CANCELLED") {
        if (!link) await db.update(appointments).set({ ehrState: "NOT_APPLICABLE" }).where(eq(appointments.id, a.id));
        return; // cancelled before it was sent: nothing to create
      }
      requireCapability(caps, "createAppointment");
      const pract = await practitionerRef(db, conn, a.practitionerId);
      const loc = await locationExternalId(db, conn);
      if (!pract || !loc) {
        await raiseConflict(db, conn, {
          kind: "UNMAPPED_RESOURCE",
          appointmentId: a.id,
          detail: "The provider or location has no EHR mapping.",
          dedupeKey: `unmapped-write:${a.id}`,
        });
        throw new PermanentDeliveryError("UNMAPPED_RESOURCE");
      }
      const pat = await patientRef(db, conn, adapter, caps, a.patientId, a.id);
      const res = link
        ? { externalId: link.externalId, etag: link.etag ?? "" }
        : await adapter.createAppointment(toFhirAppointment(a, { patient: pat, practitioner: pract, location: `Location/${loc}` }), `projectos:appointment:${a.id}:create`);
      await db.transaction(async (tx) => {
        await tx
          .insert(ehrAppointmentLinks)
          .values({ organizationId: a.organizationId, connectionId: conn.id, appointmentId: a.id, externalId: res.externalId, etag: res.etag, externalStatus: "booked" })
          .onConflictDoNothing();
        const [cur] = await tx.select().from(appointments).where(eq(appointments.id, a.id)).for("update");
        // Confirm only if nothing changed meanwhile and eligibility still allows it.
        const confirm = cur!.status === "PENDING" && cur!.eligibilityDecision === "ALLOW";
        await tx
          .update(appointments)
          .set({ ehrState: "SYNCED", ...(confirm ? { status: "CONFIRMED" } : {}), version: cur!.version + 1 })
          .where(eq(appointments.id, a.id));
        await systemEvent(tx, a.organizationId, a.id, {
          event: "EHR_CONFIRMED",
          from: cur!.status,
          to: confirm ? "CONFIRMED" : cur!.status,
          reason: `Accepted by the EHR (${conn.vendor === "SYNTHETIC_SIMULATOR" ? "synthetic simulator" : conn.vendor})`,
        });
      });
      return;
    }
    if (!link) throw new PermanentDeliveryError("No EHR mapping for this appointment");
    if (op === "UPDATE") {
      requireCapability(caps, "updateAppointment");
      const pract = await practitionerRef(db, conn, a.practitionerId);
      const loc = await locationExternalId(db, conn);
      const pat = await patientRef(db, conn, adapter, caps, a.patientId, a.id);
      const r = await adapter.updateAppointment(link.externalId, toFhirAppointment(a, { patient: pat, practitioner: pract!, location: `Location/${loc}` }), link.etag);
      await db.transaction(async (tx) => {
        await tx.update(ehrAppointmentLinks).set({ etag: r.etag, lastSyncedAt: new Date() }).where(eq(ehrAppointmentLinks.id, link.id));
        const [cur] = await tx.select().from(appointments).where(eq(appointments.id, a.id)).for("update");
        const confirm = cur!.status === "PENDING" && cur!.eligibilityDecision === "ALLOW";
        await tx
          .update(appointments)
          .set({ ehrState: "SYNCED", ...(confirm ? { status: "CONFIRMED" } : {}), version: cur!.version + 1 })
          .where(eq(appointments.id, a.id));
        await systemEvent(tx, a.organizationId, a.id, {
          event: "EHR_CONFIRMED",
          from: cur!.status,
          to: confirm ? "CONFIRMED" : cur!.status,
          reason: "Reschedule accepted by the EHR",
        });
      });
      return;
    }
    // CANCEL
    requireCapability(caps, "cancelAppointment");
    const r = await adapter.cancelAppointment(link.externalId, link.etag);
    await db.transaction(async (tx) => {
      await tx.update(ehrAppointmentLinks).set({ etag: r.etag, externalStatus: "cancelled", lastSyncedAt: new Date() }).where(eq(ehrAppointmentLinks.id, link.id));
      await tx.update(appointments).set({ ehrState: "SYNCED" }).where(eq(appointments.id, a.id));
      await systemEvent(tx, a.organizationId, a.id, { event: "EHR_CANCELLED", reason: "Cancellation accepted by the EHR" });
    });
  } catch (e) {
    const f = writeFailure(e);
    if (f instanceof EhrUnavailableError) {
      await db
        .update(ehrConnections)
        .set({ lastErrorAt: new Date(), lastError: `WRITE: ${f.message}` })
        .where(eq(ehrConnections.id, conn.id));
    }
    throw f;
  }
}

/** A write that cannot succeed (or exhausted its retries): staff must see it — never a silent drop. */
export async function onEhrWriteDead(db: Db, ev: OutboxRow, error: string) {
  const { appointmentId, op } = ev.payload as { appointmentId: string; op: EhrOp };
  const [a] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
  if (!a) return;
  const conn = await connForSite(db, a.organizationId, a.siteId);
  await db.transaction(async (tx) => {
    await tx.update(appointments).set({ ehrState: "FAILED" }).where(eq(appointments.id, a.id));
    await systemEvent(tx, a.organizationId, a.id, { event: "EHR_WRITE_FAILED", reason: `EHR ${op.toLowerCase()} failed: ${error.slice(0, 160)}` });
    // Mapping problems already raised their own specific conflict (with Retry); don't add a second one.
    const specific = error.startsWith("PATIENT_") || error === "UNMAPPED_RESOURCE";
    if (conn && !specific)
      await raiseConflict(tx, conn, {
        kind: "WRITE_FAILED",
        appointmentId: a.id,
        detail: `EHR ${op.toLowerCase()} did not complete: ${error.slice(0, 200)}. The booking is NOT confirmed. Fix the cause, then Retry.`,
        dedupeKey: `write:${ev.id}`,
      });
  });
}

export function registerEhrOutbox() {
  OUTBOX_HANDLERS[EHR_WRITE] = { deliver: deliverEhrWrite, onDead: onEhrWriteDead };
}
registerEhrOutbox();

// ------------------------------------------------------------------ staff-facing operations

const conflictResolve = z.object({ action: z.enum(["ACCEPT_EHR", "RETRY", "RESOLVED", "DISMISS"]), note: z.string().trim().max(300).optional() });

/**
 * Resolve a conflict. ACCEPT_EHR (external cancellation) cancels the local booking without sending another cancel;
 * RETRY re-queues the EHR write (same EHR idempotency key → still exactly one remote appointment).
 */
export async function resolveConflict(db: Db, ctx: AuthContext, id: string, input: unknown, now = new Date()) {
  const d = parse(conflictResolve, input);
  await authorize(db, ctx, "integrations.manage", {}, { action: "integration.conflict.resolve", resourceType: "integration_conflict", resourceId: id });
  const [c] = await db
    .select()
    .from(integrationConflicts)
    .where(and(eq(integrationConflicts.organizationId, ctx.organizationId), eq(integrationConflicts.id, id)));
  if (!c) throw notFound("Conflict");
  if (c.status !== "OPEN") throw new AppError("CONFLICT", "This conflict is already closed.");
  if (d.action === "ACCEPT_EHR") {
    if (c.kind !== "EXTERNAL_CANCELLED" || !c.appointmentId)
      throw new AppError("VALIDATION_FAILED", "Accepting the EHR is only automatic for EHR cancellations; reschedule manually for other changes.");
    const [a] = await db.select().from(appointments).where(eq(appointments.id, c.appointmentId));
    if (a && a.status !== "CANCELLED") await cancelAppointment(db, ctx, a.id, { version: a.version, reason: "Cancelled in the EHR (master schedule)" }, now);
    await db.update(appointments).set({ ehrState: "SYNCED" }).where(eq(appointments.id, c.appointmentId));
  }
  if (d.action === "RETRY") {
    if (!c.appointmentId) throw new AppError("VALIDATION_FAILED", "Nothing to retry for this conflict.");
    const [a] = await db.select().from(appointments).where(eq(appointments.id, c.appointmentId));
    if (!a) throw notFound("Appointment");
    const link = await db.select().from(ehrAppointmentLinks).where(eq(ehrAppointmentLinks.appointmentId, a.id));
    const op: EhrOp = a.status === "CANCELLED" ? "CANCEL" : link.length ? "UPDATE" : "CREATE";
    await db.transaction(async (tx) => {
      const [u] = await tx
        .update(appointments)
        .set({ ehrState: op === "CANCEL" ? "PENDING_CANCEL" : op === "UPDATE" ? "PENDING_UPDATE" : "PENDING_CREATE", version: a.version + 1 })
        .where(eq(appointments.id, a.id))
        .returning();
      await enqueueOutbox(tx, ctx.organizationId, EHR_WRITE, `ehr:${op.toLowerCase()}:${a.id}:retry:${c.id}:${u!.version}`, { appointmentId: a.id, op }, 6);
    });
  }
  const [r] = await db
    .update(integrationConflicts)
    .set({ status: d.action === "DISMISS" ? "DISMISSED" : "RESOLVED", resolution: `${d.action}${d.note ? `: ${d.note}` : ""}`, resolvedBy: ctx.userId, resolvedAt: now })
    .where(eq(integrationConflicts.id, id))
    .returning();
  await audit(db, ctx, { action: "integration.conflict.resolve", resourceType: "integration_conflict", resourceId: id, metadata: { kind: c.kind, action: d.action } });
  return r!;
}

const siteModeInput = z.object({
  ehrSyncMode: z.enum(["DEMO", "STANDALONE_APPROVED", "EHR_MASTER", "READ_ONLY"]),
  ehrFreshnessMinutes: z.coerce.number().int().min(5).max(1440).optional(),
});

/** Change a site's source-of-truth mode (audited). STANDALONE_APPROVED is refused outside approved modes. */
export async function setSiteEhrMode(db: Db, ctx: AuthContext, siteId: string, input: unknown) {
  const d = parse(siteModeInput, input);
  await authorize(db, ctx, "integrations.manage", {}, { action: "integration.site_mode", resourceType: "site", resourceId: siteId });
  if (d.ehrSyncMode === "STANDALONE_APPROVED" && !["PILOT_APPROVED", "PRODUCTION_APPROVED"].includes(process.env.APP_MODE ?? "DEVELOPMENT"))
    throw new AppError("VALIDATION_FAILED", "STANDALONE_APPROVED needs a signed source-of-truth decision and an approved APP_MODE. Not available in synthetic modes.", [
      { code: "NOT_APPROVED", field: "ehrSyncMode" },
    ]);
  const [s] = await db
    .update(sites)
    .set({ ehrSyncMode: d.ehrSyncMode, ...(d.ehrFreshnessMinutes ? { ehrFreshnessMinutes: d.ehrFreshnessMinutes } : {}) })
    .where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.id, siteId)))
    .returning();
  if (!s) throw notFound("Site");
  await audit(db, ctx, { action: "integration.site_mode", resourceType: "site", resourceId: siteId, metadata: { ehrSyncMode: d.ehrSyncMode } });
  return s;
}

/**
 * Create the site's connection to the SYNTHETIC simulator and seed the simulated EHR with this site's location,
 * practitioners (mapped) and synthetic patients matched by MRN (a few deliberately missing / duplicated so the
 * patient-mapping conflicts can be rehearsed). Real vendors are added as UNVERIFIED_VENDOR with no capabilities.
 */
export async function connectSimulator(
  db: Db,
  ctx: AuthContext | { system: string; organizationId: string },
  siteId: string,
  opts: { missingMrns?: string[]; duplicateMrns?: string[] } = {},
) {
  const org = ctx.organizationId;
  if (!("system" in ctx)) await authorize(db, ctx, "integrations.manage", {}, { action: "integration.connect", resourceType: "site", resourceId: siteId });
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.organizationId, org), eq(sites.id, siteId)));
  if (!site) throw notFound("Site");
  const existing = await connForSite(db, org, siteId);
  if (existing) return existing;
  return db.transaction(async (tx) => {
    const [conn] = await tx
      .insert(ehrConnections)
      .values({ organizationId: org, siteId, vendor: "SYNTHETIC_SIMULATOR", displayName: `Synthetic EHR simulator — ${site.code}`, capabilities: simulatorCapabilities() })
      .returning();
    const locExt = `loc-${site.code.toLowerCase()}`;
    await tx.insert(ehrSimResources).values({ connectionId: conn!.id, externalId: locExt, resourceType: "Location", identifier: site.id, display: `${site.name} (SYNTHETIC)` });
    await tx.insert(ehrResourceLinks).values({ organizationId: org, connectionId: conn!.id, kind: "LOCATION", localId: site.id, externalId: locExt, matchedBy: "SETUP" });
    const pracs = await tx
      .select({ id: practitioners.id, name: practitioners.displayName })
      .from(practitioners)
      .innerJoin(practitionerSites, eq(practitionerSites.practitionerId, practitioners.id))
      .where(and(eq(practitioners.organizationId, org), eq(practitionerSites.siteId, siteId)));
    for (const p of pracs) {
      const ext = `prac-${p.id.slice(0, 8)}`;
      await tx.insert(ehrSimResources).values({ connectionId: conn!.id, externalId: ext, resourceType: "Practitioner", identifier: p.id, display: p.name });
      await tx.insert(ehrResourceLinks).values({ organizationId: org, connectionId: conn!.id, kind: "PRACTITIONER", localId: p.id, externalId: ext, matchedBy: "SETUP" });
    }
    const pats = await tx
      .select({ mrn: patients.mrn, name: patients.displayName })
      .from(patients)
      .where(and(eq(patients.organizationId, org), eq(patients.isSynthetic, true)));
    for (const p of pats) {
      if (opts.missingMrns?.includes(p.mrn)) continue;
      await tx.insert(ehrSimResources).values({ connectionId: conn!.id, externalId: `pat-${p.mrn.toLowerCase()}`, resourceType: "Patient", identifier: p.mrn, display: p.name });
      if (opts.duplicateMrns?.includes(p.mrn))
        await tx
          .insert(ehrSimResources)
          .values({ connectionId: conn!.id, externalId: `pat-${p.mrn.toLowerCase()}-dup`, resourceType: "Patient", identifier: p.mrn, display: `${p.name} (duplicate record)` });
    }
    await setSimFailureMode(tx, conn!.id, "NONE");
    await audit(tx, ctx, { action: "integration.connect", resourceType: "ehr_connection", resourceId: conn!.id, metadata: { vendor: "SYNTHETIC_SIMULATOR", siteId } });
    return conn!;
  });
}

const simInput = z.object({ failureMode: z.enum(SIM_FAILURE_MODES) });

export async function setSimulatorFailureMode(db: Db, ctx: AuthContext, connectionId: string, input: unknown) {
  const d = parse(simInput, input);
  await authorize(db, ctx, "integrations.manage", {}, { action: "integration.simulator", resourceType: "ehr_connection", resourceId: connectionId });
  const conn = await loadConn(db, ctx.organizationId, connectionId);
  if (conn.vendor !== "SYNTHETIC_SIMULATOR") throw new AppError("VALIDATION_FAILED", "Only the synthetic simulator can be told to fail.");
  await setSimFailureMode(db, connectionId, d.failureMode as SimFailureMode);
  await audit(db, ctx, { action: "integration.simulator", resourceType: "ehr_connection", resourceId: connectionId, metadata: { failureMode: d.failureMode } });
  // Reflect the change immediately (the worker also checks every tick).
  await runHealthCheck(db, conn);
  return { failureMode: d.failureMode };
}

const extChangeInput = z.object({
  kind: z.enum(["BOOK_IN_EHR", "CANCEL_IN_EHR", "MOVE_IN_EHR"]),
  appointmentId: z.uuid().optional(),
  minutes: z.coerce.number().int().min(-600).max(600).default(30),
});

/** Rehearsal helper: make "someone else" change the simulated EHR directly. */
export async function simulateExternalChange(db: Db, ctx: AuthContext, connectionId: string, input: unknown, now = new Date()) {
  const d = parse(extChangeInput, input);
  await authorize(db, ctx, "integrations.manage", {}, { action: "integration.simulator", resourceType: "ehr_connection", resourceId: connectionId });
  const conn = await loadConn(db, ctx.organizationId, connectionId);
  if (conn.vendor !== "SYNTHETIC_SIMULATOR") throw new AppError("VALIDATION_FAILED", "Only available for the synthetic simulator.");
  if (d.kind === "BOOK_IN_EHR") {
    const [p] = await db
      .select({ ext: ehrResourceLinks.externalId })
      .from(ehrResourceLinks)
      .where(and(eq(ehrResourceLinks.connectionId, conn.id), eq(ehrResourceLinks.kind, "PRACTITIONER")))
      .orderBy(asc(ehrResourceLinks.externalId))
      .limit(1);
    const loc = await locationExternalId(db, conn);
    if (!p || !loc) throw new AppError("VALIDATION_FAILED", "No mapped practitioner at this site.");
    const start = new Date(Math.ceil((now.getTime() + 26 * 3600_000) / 1_800_000) * 1_800_000);
    const ext = await simulateEhrSideBooking(db, conn.id, { practitionerExternalId: p.ext, locationExternalId: loc, start, end: new Date(start.getTime() + 60 * 60_000) });
    await audit(db, ctx, { action: "integration.simulator", resourceType: "ehr_connection", resourceId: connectionId, metadata: { kind: d.kind } });
    return { externalId: ext };
  }
  if (!d.appointmentId) throw new AppError("VALIDATION_FAILED", "Choose a synced appointment.", [{ code: "REQUIRED", field: "appointmentId" }]);
  const [link] = await db
    .select()
    .from(ehrAppointmentLinks)
    .where(and(eq(ehrAppointmentLinks.organizationId, ctx.organizationId), eq(ehrAppointmentLinks.appointmentId, d.appointmentId)));
  if (!link) throw new AppError("VALIDATION_FAILED", "That appointment is not in the EHR.");
  await simulateEhrSideChange(db, conn.id, link.externalId, d.kind === "CANCEL_IN_EHR" ? { cancel: true } : { moveMinutes: d.minutes });
  await audit(db, ctx, { action: "integration.simulator", resourceType: "ehr_connection", resourceId: connectionId, metadata: { kind: d.kind } });
  return { externalId: link.externalId };
}

export async function runConnectionNow(db: Db, ctx: AuthContext, connectionId: string, what: "sync" | "reconcile", now = new Date()) {
  await authorize(db, ctx, "integrations.manage", {}, { action: `integration.${what}`, resourceType: "ehr_connection", resourceId: connectionId });
  const conn = await loadConn(db, ctx.organizationId, connectionId);
  await audit(db, ctx, { action: `integration.${what}`, resourceType: "ehr_connection", resourceId: connectionId });
  if (what === "reconcile") return reconcileConnection(db, conn, now);
  const h = await runHealthCheck(db, conn);
  if (!h.ok) return { ok: false, health: h };
  const fresh = await loadConn(db, ctx.organizationId, connectionId);
  return { ok: true, health: h, availability: await syncAvailability(db, fresh, now), changes: await pullEhrChanges(db, fresh) };
}

// ------------------------------------------------------------------ Integration Health (read model)

const CONNECTED_WINDOW_MIN = 30;

/** Never shows "connected" unless a real, recent, successful health check says so — and labels the simulator. */
export function connectionLabel(conn: Pick<Conn, "vendor" | "enabled" | "lastHealthOk" | "lastHealthAt">, now = new Date()) {
  if (conn.vendor !== "SYNTHETIC_SIMULATOR") return { tone: "red" as const, text: "Not connected — vendor API access and capabilities not verified" };
  if (!conn.enabled) return { tone: "neutral" as const, text: "Disabled" };
  if (!conn.lastHealthAt) return { tone: "amber" as const, text: "Never checked" };
  const recent = now.getTime() - conn.lastHealthAt.getTime() < CONNECTED_WINDOW_MIN * 60_000;
  if (conn.lastHealthOk && recent) return { tone: "green" as const, text: "Synthetic simulator reachable (not a real EHR)" };
  if (conn.lastHealthOk) return { tone: "amber" as const, text: "Last check OK but older than 30 min" };
  return { tone: "red" as const, text: "Unreachable at last check" };
}

export async function getIntegrationHealth(db: Db, ctx: AuthContext, now = new Date()) {
  await authorizeRead(db, ctx);
  const org = ctx.organizationId;
  const siteRows = await db.select().from(sites).where(eq(sites.organizationId, org)).orderBy(asc(sites.code));
  const conns = await db.select().from(ehrConnections).where(eq(ehrConnections.organizationId, org));
  const states = await db
    .select({ siteId: appointments.siteId, ehrState: appointments.ehrState, n: sql<number>`count(*)::int` })
    .from(appointments)
    .where(and(eq(appointments.organizationId, org), sql`${appointments.ehrState} <> 'NOT_APPLICABLE'`))
    .groupBy(appointments.siteId, appointments.ehrState);
  const conflicts = await db
    .select()
    .from(integrationConflicts)
    .where(and(eq(integrationConflicts.organizationId, org), eq(integrationConflicts.status, "OPEN")))
    .orderBy(desc(integrationConflicts.createdAt))
    .limit(100);
  const runs = await db.select().from(integrationSyncRuns).where(eq(integrationSyncRuns.organizationId, org)).orderBy(desc(integrationSyncRuns.startedAt)).limit(40);
  const outbox = await db
    .select({ status: outboxEvents.status, n: sql<number>`count(*)::int` })
    .from(outboxEvents)
    .where(and(eq(outboxEvents.organizationId, org), eq(outboxEvents.type, EHR_WRITE)))
    .groupBy(outboxEvents.status);
  const outboxProblems = await db
    .select({
      id: outboxEvents.id,
      status: outboxEvents.status,
      attempts: outboxEvents.attempts,
      maxAttempts: outboxEvents.maxAttempts,
      lastError: outboxEvents.lastError,
      availableAt: outboxEvents.availableAt,
      payload: outboxEvents.payload,
    })
    .from(outboxEvents)
    .where(and(eq(outboxEvents.organizationId, org), eq(outboxEvents.type, EHR_WRITE), inArray(outboxEvents.status, ["FAILED", "DEAD"])))
    .orderBy(desc(outboxEvents.availableAt))
    .limit(50);
  const syncedAppts = await db
    .select({ appointmentId: ehrAppointmentLinks.appointmentId, siteId: appointments.siteId, startAt: appointments.startAt, status: appointments.status })
    .from(ehrAppointmentLinks)
    .innerJoin(appointments, eq(appointments.id, ehrAppointmentLinks.appointmentId))
    .where(
      and(
        eq(ehrAppointmentLinks.organizationId, org),
        isNotNull(ehrAppointmentLinks.externalId),
        gt(appointments.startAt, now),
        inArray(appointments.status, ["CONFIRMED", "PENDING"]),
      ),
    )
    .orderBy(asc(appointments.startAt))
    .limit(50);
  const simModes = conns.length
    ? await db.execute<{ connection_id: string; failure_mode: string }>(sql`select connection_id, failure_mode from ehr_sim_state where connection_id in ${conns.map((c) => c.id)}`)
    : [];
  return {
    computedAt: now.toISOString(),
    appMode: process.env.APP_MODE ?? "DEVELOPMENT",
    sites: siteRows.map((s) => {
      const c = conns.find((x) => x.siteId === s.id) ?? null;
      const ageMin = s.ehrLastSyncedAt ? Math.round((now.getTime() - s.ehrLastSyncedAt.getTime()) / 60_000) : null;
      return {
        site: {
          id: s.id,
          code: s.code,
          name: s.name,
          mode: s.ehrSyncMode,
          freshnessMinutes: s.ehrFreshnessMinutes,
          lastSyncedAt: s.ehrLastSyncedAt?.toISOString() ?? null,
          ageMin,
        },
        fresh: ageMin !== null && ageMin <= s.ehrFreshnessMinutes,
        connection: c
          ? {
              id: c.id,
              vendor: c.vendor,
              displayName: c.displayName,
              label: connectionLabel(c, now),
              capabilities: parseCapabilities(c.capabilities),
              usableWrite: usable(parseCapabilities(c.capabilities), "createAppointment"),
              lastHealthAt: c.lastHealthAt?.toISOString() ?? null,
              lastHealthOk: c.lastHealthOk,
              lastSuccessAt: c.lastSuccessAt?.toISOString() ?? null,
              lastErrorAt: c.lastErrorAt?.toISOString() ?? null,
              lastError: c.lastError,
              simulatorFailureMode: simModes.find((m) => m.connection_id === c.id)?.failure_mode ?? null,
            }
          : null,
        ehrStates: Object.fromEntries(states.filter((x) => x.siteId === s.id).map((x) => [x.ehrState, x.n])),
        syncedUpcoming: syncedAppts.filter((a) => a.siteId === s.id).map((a) => ({ appointmentId: a.appointmentId, startAt: a.startAt.toISOString(), status: a.status })),
      };
    }),
    conflicts,
    runs,
    outbox: { counts: Object.fromEntries(outbox.map((o) => [o.status, o.n])), problems: outboxProblems },
  };
}

async function authorizeRead(db: Db, ctx: AuthContext) {
  if (hasAny(ctx, "integrations.manage") || hasAny(ctx, "scheduling.configure")) return true;
  await authorize(db, ctx, "integrations.manage", "ANY", { action: "integration.health.read", resourceType: "integration" });
  return true;
}
