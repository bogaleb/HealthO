import { addCaseAction } from "@projectos/rcm";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => addCaseAction(db, ctx, params.id, await body()), { status: 201 });
