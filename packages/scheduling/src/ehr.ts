import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@projectos/db";
import { ehrAppointmentLinks, ehrConnections, sites } from "@projectos/db/schema";
import { enqueueOutbox } from "@projectos/notifications";
import { AppError } from "@projectos/shared";
import { ehrWriteOf, type EhrMode, type EhrWrite } from "./eligibility";

/**
 * Phase 7 scheduling ↔ EHR glue (ADR-0012). Scheduling never calls the EHR directly: at an EHR_MASTER site every
 * create / reschedule / cancel writes an `ehr.write` outbox row in the SAME transaction, and the integration worker
 * delivers it. Until the EHR accepts a booking it stays PENDING (never CONFIRMED) — enforced by a DB CHECK too.
 */
export const EHR_WRITE = "ehr.write";
export type EhrOp = "CREATE" | "UPDATE" | "CANCEL";

export async function siteEhr(tx: DbOrTx, organizationId: string, siteId: string): Promise<{ mode: EhrMode; write: EhrWrite; connectionId: string | null }> {
  const [r] = await tx
    .select({
      mode: sites.ehrSyncMode,
      c: { id: ehrConnections.id, enabled: ehrConnections.enabled, capabilities: ehrConnections.capabilities, lastHealthOk: ehrConnections.lastHealthOk },
    })
    .from(sites)
    .leftJoin(ehrConnections, and(eq(ehrConnections.siteId, sites.id), eq(ehrConnections.organizationId, sites.organizationId)))
    .where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)));
  return { mode: (r?.mode ?? "DEMO") as EhrMode, write: ehrWriteOf(r?.c?.id ? r.c : null), connectionId: r?.c?.id ?? null };
}

/** Status + EHR state for a booking that eligibility allowed, at a site in the given mode. */
export function ehrBookingState(mode: EhrMode, decision: "ALLOW" | "REVIEW") {
  if (mode !== "EHR_MASTER") return { status: decision === "ALLOW" ? "CONFIRMED" : "PENDING", ehrState: "NOT_APPLICABLE" } as const;
  // ALLOW at an EHR-master site means "the write path is verified and healthy": send it, confirm on EHR acceptance.
  return decision === "ALLOW" ? ({ status: "PENDING", ehrState: "PENDING_CREATE" } as const) : ({ status: "PENDING", ehrState: "DRAFT" } as const);
}

/** Queue an EHR write for this appointment (idempotent per appointment × op × version). */
export async function queueEhrWrite(tx: DbOrTx, organizationId: string, appointmentId: string, op: EhrOp, version: number) {
  return enqueueOutbox(tx, organizationId, EHR_WRITE, `ehr:${op.toLowerCase()}:${appointmentId}:v${version}`, { appointmentId, op }, 6);
}

export async function ehrLinkOf(tx: DbOrTx, organizationId: string, appointmentId: string) {
  const [l] = await tx
    .select()
    .from(ehrAppointmentLinks)
    .where(and(eq(ehrAppointmentLinks.organizationId, organizationId), eq(ehrAppointmentLinks.appointmentId, appointmentId)));
  return l ?? null;
}

/** 503 when the authoritative EHR is unavailable and the action needs it (blueprint §6 error rules). */
export function ehrUnavailable(detail = "The EHR (master schedule for this site) is unavailable. Nothing was confirmed; the booking stays a draft.") {
  return new AppError("SERVICE_UNAVAILABLE", detail, [{ code: "EHR_UNAVAILABLE" }]);
}
