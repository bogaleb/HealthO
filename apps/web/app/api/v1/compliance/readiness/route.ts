import { getReadiness } from "@projectos/compliance";
import { api } from "@/lib/api";

/** PHI-readiness verdict: NOT APPROVED FOR REAL PHI unless every critical item is independently approved and every check passes. */
export const GET = api(async ({ ctx, db }) => getReadiness(db, ctx));
