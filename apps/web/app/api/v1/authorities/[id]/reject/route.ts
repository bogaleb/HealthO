import { rejectAuthority } from "@projectos/credentialing";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => rejectAuthority(db, ctx, params.id, await body()));
