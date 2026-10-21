import { retireRule } from "@projectos/credentialing";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => retireRule(db, ctx, params.id, await body()));
