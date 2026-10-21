import { getSite, updateSite } from "@projectos/core";
import { api } from "@/lib/api";

export const GET = api<{ id: string }>(async ({ ctx, db, params }) => getSite(db, ctx, params.id));
export const PATCH = api<{ id: string }>(async ({ ctx, db, params, body }) => updateSite(db, ctx, params.id, await body()));
