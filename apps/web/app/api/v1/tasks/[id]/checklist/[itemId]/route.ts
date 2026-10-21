import { deleteChecklistItem, updateChecklistItem } from "@projectos/core";
import { api } from "@/lib/api";

export const PATCH = api<{ id: string; itemId: string }>(async ({ ctx, db, params, body }) => updateChecklistItem(db, ctx, params.id, params.itemId, await body()));
export const DELETE = api<{ id: string; itemId: string }>(async ({ ctx, db, params }) => {
  await deleteChecklistItem(db, ctx, params.id, params.itemId);
});
