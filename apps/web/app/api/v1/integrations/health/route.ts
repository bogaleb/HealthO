import { getIntegrationHealth } from "@projectos/integrations";
import { api } from "@/lib/api";

/** EHR readiness and sync status per site. Never reports an unverified vendor as connected. */
export const GET = api(async ({ ctx, db }) => getIntegrationHealth(db, ctx));
