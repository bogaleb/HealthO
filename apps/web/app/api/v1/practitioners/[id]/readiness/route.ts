import { getProviderReadiness } from "@projectos/credentialing";
import { api, searchParams } from "@/lib/api";

export const GET = api<{ id: string }>(async ({ ctx, db, params, req }) => getProviderReadiness(db, ctx, params.id, searchParams(req).date));
