import { checkInAppointment } from "@projectos/scheduling";
import { api } from "@/lib/api";

/** Re-evaluates with the patient's confirmed CURRENT location; a non-ALLOW result stops check-in (state committed, 409/422 returned). */
export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => checkInAppointment(db, ctx, params.id, await body()));
