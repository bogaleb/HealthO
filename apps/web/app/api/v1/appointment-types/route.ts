import { createAppointmentType, getSchedulingReference } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db }) => (await getSchedulingReference(db, ctx)).appointmentTypes);
export const POST = api(async ({ ctx, db, body }) => createAppointmentType(db, ctx, await body()), { status: 201 });
