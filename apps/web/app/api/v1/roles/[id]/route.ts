import { updateRole } from "@projectos/core";
import { api } from "@/lib/api";

export const PATCH = api<{ id: string }>(async ({ ctx, db, params, body }) => updateRole(db, ctx, params.id, await body()));
