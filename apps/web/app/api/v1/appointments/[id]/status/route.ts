import { changeAppointmentStatus } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => changeAppointmentStatus(db, ctx, params.id, await body()));
