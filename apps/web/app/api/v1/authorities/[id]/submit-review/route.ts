import { submitAuthority } from "@projectos/credentialing";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => submitAuthority(db, ctx, params.id, await body()));
