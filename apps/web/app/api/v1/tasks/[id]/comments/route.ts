import { addComment } from "@projectos/core";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => addComment(db, ctx, params.id, await body()), { status: 201 });
