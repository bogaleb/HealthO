import { resolveConflict } from "@projectos/integrations";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => resolveConflict(db, ctx, params.id, await body()));
