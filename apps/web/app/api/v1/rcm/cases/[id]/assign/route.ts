import { assignCase } from "@projectos/rcm";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => assignCase(db, ctx, params.id, await body()), { status: 200 });
