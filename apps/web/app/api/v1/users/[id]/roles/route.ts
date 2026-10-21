import { setRoles } from "@projectos/core";
import { api } from "@/lib/api";

export const PUT = api<{ id: string }>(async ({ ctx, db, params, body }) => setRoles(db, ctx, params.id, await body()));
