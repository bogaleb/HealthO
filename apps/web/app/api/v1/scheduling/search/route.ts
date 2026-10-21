import { searchSlots } from "@projectos/scheduling";
import { api } from "@/lib/api";

/** Server-side slot search; eligibility is POLICY_PENDING until Phase 5. */
export const POST = api(async ({ ctx, db, body }) => searchSlots(db, ctx, await body()));
