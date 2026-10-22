import { simulateExternalChange } from "@projectos/integrations";
import { api } from "@/lib/api";

/** Rehearsal control: book / cancel / move something directly in the synthetic EHR. */
export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => simulateExternalChange(db, ctx, params.id, await body()));
