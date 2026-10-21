import { approveRule } from "@projectos/credentialing";
import { api } from "@/lib/api";

/** policy.publish only; dual control (approver ≠ author). */
export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => approveRule(db, ctx, params.id, await body()));
