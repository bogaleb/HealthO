import { recheckAppointment } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params }) => recheckAppointment(db, ctx, params.id));
