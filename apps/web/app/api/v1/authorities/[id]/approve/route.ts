import { verifyAuthority } from "@projectos/credentialing";
import { api } from "@/lib/api";

/** Privileged: credentialing.approve; dual control (not your own submission). */
export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => verifyAuthority(db, ctx, params.id, await body()));
