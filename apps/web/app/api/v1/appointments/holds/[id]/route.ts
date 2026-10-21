import { getHold, releaseHold } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const GET = api<{ id: string }>(async ({ ctx, db, params }) => getHold(db, ctx, params.id));
export const DELETE = api<{ id: string }>(async ({ ctx, db, params }) => {
  await releaseHold(db, ctx, params.id);
});
