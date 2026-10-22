import { linkCaseTask } from "@projectos/rcm";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => linkCaseTask(db, ctx, params.id, await body()), { status: 201 });
