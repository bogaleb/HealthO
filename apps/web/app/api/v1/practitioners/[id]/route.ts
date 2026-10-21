import { getPractitionerDetail, updatePractitioner } from "@projectos/credentialing";
import { api } from "@/lib/api";

export const GET = api<{ id: string }>(async ({ ctx, db, params }) => getPractitionerDetail(db, ctx, params.id));
export const PATCH = api<{ id: string }>(async ({ ctx, db, params, body }) => updatePractitioner(db, ctx, params.id, await body()));
