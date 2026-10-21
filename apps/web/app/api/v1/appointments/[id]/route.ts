import { getAppointment, rescheduleAppointment } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const GET = api<{ id: string }>(async ({ ctx, db, params }) => getAppointment(db, ctx, params.id));
/** Reschedule (atomic; version checked). */
export const PATCH = api<{ id: string }>(async ({ ctx, db, params, body }) => rescheduleAppointment(db, ctx, params.id, await body()));
