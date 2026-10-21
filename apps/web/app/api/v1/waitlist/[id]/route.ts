import { cancelWaitlistEntry } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const DELETE = api<{ id: string }>(async ({ ctx, db, params }) => {
  await cancelWaitlistEntry(db, ctx, params.id);
});
