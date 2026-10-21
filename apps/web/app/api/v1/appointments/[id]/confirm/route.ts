import { confirmPendingAppointment } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => confirmPendingAppointment(db, ctx, params.id, await body()));
