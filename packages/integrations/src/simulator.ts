import { and, asc, eq, gt, gte, lt, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@projectos/db";
import { ehrSimAppointments, ehrSimResources, ehrSimState } from "@projectos/db/schema";
import {
  EHR_CAPABILITIES,
  EhrRejectedError,
  EhrUnavailableError,
  EhrVersionConflictError,
  type BusyBlock,
  type CapabilityFlags,
  type EhrSchedulingAdapter,
  type FhirAppointment,
} from "./adapter";

/**
 * SYNTHETIC EHR SIMULATOR — stands in for a vendor FHIR R4 scheduling API so the integration can be built and
 * rehearsed without real data. State lives in `ehr_sim_*` tables (shared by web + worker). It is deliberately strict:
 * ETag checks, idempotency keys, a change feed, and switchable failure modes for drills.
 */
export const SIM_FAILURE_MODES = ["NONE", "UNREACHABLE", "FAIL_WRITES", "TIMEOUT_AFTER_WRITE"] as const;
export type SimFailureMode = (typeof SIM_FAILURE_MODES)[number];

/** Everything is implemented by the simulator; "verified" means verified against the simulator only. */
export function simulatorCapabilities(): CapabilityFlags {
  return Object.fromEntries(EHR_CAPABILITIES.map((c) => [c, { supported: true, verified: true, verifiedBy: "Synthetic simulator (no vendor)" }])) as CapabilityFlags;
}

const etagOf = (v: number) => `W/"${v}"`;
const idOf = (r: string) => r.split("/")[1] ?? r;

export class SyntheticEhrSimulator implements EhrSchedulingAdapter {
  readonly vendor = "SYNTHETIC_SIMULATOR";
  readonly capabilities = simulatorCapabilities();
  constructor(
    private readonly db: Db,
    readonly connectionId: string,
    private readonly locationExternalId: string,
  ) {}

  private async mode(): Promise<SimFailureMode> {
    const [s] = await this.db.select({ m: ehrSimState.failureMode }).from(ehrSimState).where(eq(ehrSimState.connectionId, this.connectionId));
    return (s?.m as SimFailureMode) ?? "NONE";
  }
  private async reachable() {
    if ((await this.mode()) === "UNREACHABLE") throw new EhrUnavailableError("Synthetic EHR unreachable (simulated outage)");
  }
  private async writable() {
    const m = await this.mode();
    if (m === "UNREACHABLE") throw new EhrUnavailableError("Synthetic EHR unreachable (simulated outage)");
    if (m === "FAIL_WRITES") throw new EhrUnavailableError("Synthetic EHR returned 503 for writes (simulated)");
    return m;
  }
  private async nextSeq(tx: DbOrTx) {
    const [r] = await tx
      .insert(ehrSimState)
      .values({ connectionId: this.connectionId, changeSeq: 1 })
      .onConflictDoUpdate({ target: ehrSimState.connectionId, set: { changeSeq: sql`${ehrSimState.changeSeq} + 1` } })
      .returning({ seq: ehrSimState.changeSeq });
    return r!.seq;
  }

  async health() {
    const t = Date.now();
    const m = await this.mode();
    if (m === "UNREACHABLE") return { ok: false, latencyMs: Date.now() - t, detail: "Simulated outage: EHR unreachable" };
    return { ok: true, latencyMs: Date.now() - t, detail: m === "NONE" ? "Synthetic simulator reachable" : `Reachable, failure mode ${m}` };
  }

  private async resources(type: string) {
    await this.reachable();
    return this.db
      .select({ externalId: ehrSimResources.externalId, identifier: ehrSimResources.identifier, display: ehrSimResources.display })
      .from(ehrSimResources)
      .where(and(eq(ehrSimResources.connectionId, this.connectionId), eq(ehrSimResources.resourceType, type)));
  }
  getProviders = () => this.resources("Practitioner");
  getLocations = () => this.resources("Location");

  async searchPatients(q: { identifier: string }) {
    await this.reachable();
    return this.db
      .select({ externalId: ehrSimResources.externalId, identifier: ehrSimResources.identifier, display: ehrSimResources.display })
      .from(ehrSimResources)
      .where(and(eq(ehrSimResources.connectionId, this.connectionId), eq(ehrSimResources.resourceType, "Patient"), eq(ehrSimResources.identifier, q.identifier)));
  }

  async getAvailability(range: { from: Date; to: Date }): Promise<BusyBlock[]> {
    await this.reachable();
    const rows = await this.db
      .select()
      .from(ehrSimAppointments)
      .where(
        and(
          eq(ehrSimAppointments.connectionId, this.connectionId),
          eq(ehrSimAppointments.locationRef, `Location/${this.locationExternalId}`),
          lt(ehrSimAppointments.startAt, range.to),
          gt(ehrSimAppointments.endAt, range.from),
        ),
      );
    return rows.map((r) => ({
      externalId: r.externalId,
      practitionerRef: r.practitionerRef,
      locationRef: r.locationRef,
      start: r.startAt,
      end: r.endAt,
      status: r.status as "booked" | "cancelled",
      origin: r.origin as "PROJECTOS" | "EHR",
    }));
  }

  private toFhir(r: typeof ehrSimAppointments.$inferSelect): FhirAppointment & { etag: string; origin: "PROJECTOS" | "EHR" } {
    return {
      resourceType: "Appointment",
      id: r.externalId,
      meta: { versionId: String(r.versionId) },
      status: r.status as "booked" | "cancelled",
      start: r.startAt.toISOString(),
      end: r.endAt.toISOString(),
      participant: [
        ...(r.patientRef ? [{ actor: { reference: r.patientRef }, status: "accepted" as const }] : []),
        { actor: { reference: r.practitionerRef }, status: "accepted" as const },
        { actor: { reference: r.locationRef }, status: "accepted" as const },
      ],
      etag: etagOf(r.versionId),
      origin: r.origin as "PROJECTOS" | "EHR",
    };
  }

  private refsOf(a: FhirAppointment) {
    const find = (t: string) => a.participant.find((p) => p.actor.reference.startsWith(`${t}/`))?.actor.reference ?? null;
    const practitioner = find("Practitioner");
    const location = find("Location");
    if (!practitioner || !location) throw new EhrRejectedError("Appointment needs a Practitioner and a Location participant", "INVALID");
    return { patient: find("Patient"), practitioner, location };
  }

  private async exists(type: string, reference: string | null) {
    if (!reference) return false;
    const [r] = await this.db
      .select({ id: ehrSimResources.externalId })
      .from(ehrSimResources)
      .where(and(eq(ehrSimResources.connectionId, this.connectionId), eq(ehrSimResources.resourceType, type), eq(ehrSimResources.externalId, idOf(reference))));
    return !!r;
  }

  async createAppointment(appt: FhirAppointment, idempotencyKey: string) {
    const mode = await this.writable();
    const refs = this.refsOf(appt);
    if (!(await this.exists("Patient", refs.patient))) throw new EhrRejectedError("Unknown Patient reference", "UNKNOWN_PATIENT");
    if (!(await this.exists("Practitioner", refs.practitioner))) throw new EhrRejectedError("Unknown Practitioner reference", "UNKNOWN_PRACTITIONER");
    const start = new Date(appt.start);
    const end = new Date(appt.end);
    const result = await this.db.transaction(async (tx) => {
      // Idempotency: the same key always returns the original appointment (no duplicate on retry).
      const [prior] = await tx
        .select()
        .from(ehrSimAppointments)
        .where(and(eq(ehrSimAppointments.connectionId, this.connectionId), eq(ehrSimAppointments.idempotencyKey, idempotencyKey)));
      if (prior) return { externalId: prior.externalId, etag: etagOf(prior.versionId) };
      const [clash] = await tx
        .select({ id: ehrSimAppointments.externalId })
        .from(ehrSimAppointments)
        .where(
          and(
            eq(ehrSimAppointments.connectionId, this.connectionId),
            eq(ehrSimAppointments.practitionerRef, refs.practitioner),
            eq(ehrSimAppointments.status, "booked"),
            lt(ehrSimAppointments.startAt, end),
            gt(ehrSimAppointments.endAt, start),
          ),
        );
      if (clash) throw new EhrRejectedError("The practitioner is already booked at that time in the EHR", "SLOT_TAKEN");
      const externalId = `sim-${crypto.randomUUID().slice(0, 12)}`;
      await tx.insert(ehrSimAppointments).values({
        connectionId: this.connectionId,
        externalId,
        patientRef: refs.patient,
        practitionerRef: refs.practitioner,
        locationRef: refs.location,
        startAt: start,
        endAt: end,
        status: "booked",
        origin: "PROJECTOS",
        idempotencyKey,
        changeSeq: await this.nextSeq(tx),
      });
      return { externalId, etag: etagOf(1) };
    });
    if (mode === "TIMEOUT_AFTER_WRITE") throw new EhrUnavailableError("Timed out waiting for the EHR response (the write may have succeeded)");
    return result;
  }

  private async mutate(externalId: string, ifMatch: string | null, change: (r: typeof ehrSimAppointments.$inferSelect) => Partial<typeof ehrSimAppointments.$inferInsert>) {
    const mode = await this.writable();
    const out = await this.db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(ehrSimAppointments)
        .where(and(eq(ehrSimAppointments.connectionId, this.connectionId), eq(ehrSimAppointments.externalId, externalId)))
        .for("update");
      if (!r) throw new EhrRejectedError("Appointment not found in the EHR", "NOT_FOUND");
      if (ifMatch && ifMatch !== etagOf(r.versionId)) throw new EhrVersionConflictError();
      const v = r.versionId + 1;
      await tx
        .update(ehrSimAppointments)
        .set({ ...change(r), versionId: v, changeSeq: await this.nextSeq(tx) })
        .where(and(eq(ehrSimAppointments.connectionId, this.connectionId), eq(ehrSimAppointments.externalId, externalId)));
      return { etag: etagOf(v) };
    });
    if (mode === "TIMEOUT_AFTER_WRITE") throw new EhrUnavailableError("Timed out waiting for the EHR response (the write may have succeeded)");
    return out;
  }

  updateAppointment(externalId: string, appt: FhirAppointment, ifMatch: string | null) {
    const refs = this.refsOf(appt);
    return this.mutate(externalId, ifMatch, () => ({ startAt: new Date(appt.start), endAt: new Date(appt.end), practitionerRef: refs.practitioner, locationRef: refs.location }));
  }

  cancelAppointment(externalId: string, ifMatch: string | null) {
    return this.mutate(externalId, ifMatch, (r) => (r.status === "cancelled" ? {} : { status: "cancelled" }));
  }

  async getAppointmentByExternalId(externalId: string) {
    await this.reachable();
    const [r] = await this.db
      .select()
      .from(ehrSimAppointments)
      .where(and(eq(ehrSimAppointments.connectionId, this.connectionId), eq(ehrSimAppointments.externalId, externalId)));
    return r ? this.toFhir(r) : null;
  }

  async pullChanges(cursor: string | null) {
    await this.reachable();
    const since = Number(cursor ?? 0) || 0;
    const rows = await this.db
      .select()
      .from(ehrSimAppointments)
      .where(and(eq(ehrSimAppointments.connectionId, this.connectionId), gt(ehrSimAppointments.changeSeq, since)))
      .orderBy(asc(ehrSimAppointments.changeSeq))
      .limit(500);
    const last = rows.length ? rows[rows.length - 1]!.changeSeq : since;
    return { changes: rows.map((r) => this.toFhir(r)), cursor: String(last) };
  }
}

// ---------------------------------------------------------------- simulator administration (rehearsals and tests)

export async function setSimFailureMode(db: DbOrTx, connectionId: string, mode: SimFailureMode) {
  await db
    .insert(ehrSimState)
    .values({ connectionId, failureMode: mode })
    .onConflictDoUpdate({ target: ehrSimState.connectionId, set: { failureMode: mode } });
}

async function bumpSeq(tx: DbOrTx, connectionId: string) {
  const [r] = await tx
    .insert(ehrSimState)
    .values({ connectionId, changeSeq: 1 })
    .onConflictDoUpdate({ target: ehrSimState.connectionId, set: { changeSeq: sql`${ehrSimState.changeSeq} + 1` } })
    .returning({ seq: ehrSimState.changeSeq });
  return r!.seq;
}

/** Someone books directly in the EHR (not through ProjectOS): shows up as busy time after the next sync. */
export async function simulateEhrSideBooking(db: Db, connectionId: string, b: { practitionerExternalId: string; locationExternalId: string; start: Date; end: Date }) {
  const externalId = `ehr-${crypto.randomUUID().slice(0, 12)}`;
  await db.transaction(async (tx) =>
    tx.insert(ehrSimAppointments).values({
      connectionId,
      externalId,
      patientRef: null,
      practitionerRef: `Practitioner/${b.practitionerExternalId}`,
      locationRef: `Location/${b.locationExternalId}`,
      startAt: b.start,
      endAt: b.end,
      status: "booked",
      origin: "EHR",
      changeSeq: await bumpSeq(tx, connectionId),
    }),
  );
  return externalId;
}

/** EHR staff cancel or move an appointment that ProjectOS created (drives the reconciliation conflict path). */
export async function simulateEhrSideChange(db: Db, connectionId: string, externalId: string, change: { cancel?: boolean; moveMinutes?: number }) {
  await db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(ehrSimAppointments)
      .where(and(eq(ehrSimAppointments.connectionId, connectionId), eq(ehrSimAppointments.externalId, externalId)))
      .for("update");
    if (!r) throw new Error("No such simulated appointment");
    const ms = (change.moveMinutes ?? 0) * 60_000;
    await tx
      .update(ehrSimAppointments)
      .set({
        status: change.cancel ? "cancelled" : r.status,
        startAt: new Date(r.startAt.getTime() + ms),
        endAt: new Date(r.endAt.getTime() + ms),
        versionId: r.versionId + 1,
        changeSeq: await bumpSeq(tx, connectionId),
      })
      .where(and(eq(ehrSimAppointments.connectionId, connectionId), eq(ehrSimAppointments.externalId, externalId)));
  });
}

/** Delete one remote appointment outright (reconciliation must notice the mapping now points at nothing). */
export async function simulateEhrSideDeletion(db: Db, connectionId: string, externalId: string) {
  await db.execute(sql`delete from ehr_sim_appointments where connection_id = ${connectionId} and external_id = ${externalId}`);
}

export async function simAppointmentCount(db: Db, connectionId: string, from?: Date) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ehrSimAppointments)
    .where(and(eq(ehrSimAppointments.connectionId, connectionId), from ? gte(ehrSimAppointments.startAt, from) : undefined));
  return r?.n ?? 0;
}
