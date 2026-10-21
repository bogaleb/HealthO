import { removeDependency } from "@projectos/core";
import { api } from "@/lib/api";

export const DELETE = api<{ id: string; depId: string }>(async ({ ctx, db, params }) => {
  await removeDependency(db, ctx, params.id, params.depId);
});
