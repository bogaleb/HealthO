import { setSiteEhrMode } from "@projectos/integrations";
import { api } from "@/lib/api";

export const PATCH = api<{ id: string }>(async ({ ctx, db, params, body }) => setSiteEhrMode(db, ctx, params.id, await body()));
