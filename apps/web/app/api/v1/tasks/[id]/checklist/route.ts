import { addChecklistItem } from "@projectos/core";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => addChecklistItem(db, ctx, params.id, await body()), { status: 201 });
