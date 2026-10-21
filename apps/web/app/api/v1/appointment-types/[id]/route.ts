import { updateAppointmentType } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const PATCH = api<{ id: string }>(async ({ ctx, db, params, body }) => updateAppointmentType(db, ctx, params.id, await body()));
