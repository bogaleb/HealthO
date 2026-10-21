import { getProjectDetail, updateProject } from "@projectos/core";
import { api } from "@/lib/api";

export const GET = api<{ id: string }>(async ({ ctx, db, params }) => getProjectDetail(db, ctx, params.id));
export const PATCH = api<{ id: string }>(async ({ ctx, db, params, body }) => updateProject(db, ctx, params.id, await body()));
