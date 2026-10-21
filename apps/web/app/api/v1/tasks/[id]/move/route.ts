import { moveTask } from "@projectos/core";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => moveTask(db, ctx, params.id, await body()));
