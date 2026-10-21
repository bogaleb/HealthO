import { cancelAppointment, waitlistCandidatesForSlot } from "@projectos/scheduling";
import { api } from "@/lib/api";

/** Cancel; the response says how many active waitlist requests could use the freed time (nothing is auto-booked). */
export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => {
  const a = await cancelAppointment(db, ctx, params.id, await body());
  return { ...a, waitlistCandidates: await waitlistCandidatesForSlot(db, ctx.organizationId, a) };
});
