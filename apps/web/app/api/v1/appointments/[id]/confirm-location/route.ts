import { changeAppointmentLocation } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => changeAppointmentLocation(db, ctx, params.id, await body()));
