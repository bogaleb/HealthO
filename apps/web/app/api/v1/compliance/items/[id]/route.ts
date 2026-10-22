import { updateComplianceItem } from "@projectos/compliance";
import { api } from "@/lib/api";

/** `{action: UPDATE | SUBMIT_EVIDENCE | APPROVE | REOPEN, version, …}` — approval by a different person than the submitter. */
export const PATCH = api<{ id: string }>(async ({ ctx, db, params, body }) => updateComplianceItem(db, ctx, params.id, await body()));
