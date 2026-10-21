import { updateEnrollment } from "@projectos/credentialing";
import { api } from "@/lib/api";

export const PATCH = api<{ id: string }>(async ({ ctx, db, params, body }) => updateEnrollment(db, ctx, params.id, await body()));
