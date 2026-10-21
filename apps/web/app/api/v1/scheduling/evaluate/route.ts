import { explainEligibility } from "@projectos/scheduling";
import { api } from "@/lib/api";

/** Explain eligibility for a candidate (not persisted). Same decideEligibility as booking, search and check-in. */
export const POST = api(async ({ ctx, db, body }) => explainEligibility(db, ctx, await body()));
