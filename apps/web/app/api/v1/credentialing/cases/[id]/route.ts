import { updateCase } from "@projectos/credentialing";
import { api } from "@/lib/api";

export const PATCH = api<{ id: string }>(async ({ ctx, db, params, body }) => updateCase(db, ctx, params.id, await body()));
