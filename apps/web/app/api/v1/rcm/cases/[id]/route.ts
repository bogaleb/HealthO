import { getCaseDetail, updateCase } from "@projectos/rcm";
import { api } from "@/lib/api";

export const GET = api<{ id: string }>(async ({ ctx, db, params }) => getCaseDetail(db, ctx, params.id));
export const PATCH = api<{ id: string }>(async ({ ctx, db, params, body }) => updateCase(db, ctx, params.id, await body()));
