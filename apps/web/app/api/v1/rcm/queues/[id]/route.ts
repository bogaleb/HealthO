import { updateQueue } from "@projectos/rcm";
import { api } from "@/lib/api";

export const PATCH = api<{ id: string }>(async ({ ctx, db, params, body }) => updateQueue(db, ctx, params.id, await body()));
