import { updateMembership } from "@projectos/core";
import { api } from "@/lib/api";

/** [id] is the membership id. */
export const PATCH = api<{ id: string }>(async ({ ctx, db, params, body }) => updateMembership(db, ctx, params.id, await body()));
