import { setSimulatorFailureMode } from "@projectos/integrations";
import { api } from "@/lib/api";

/** Rehearsal control: make the synthetic EHR fail (UNREACHABLE, FAIL_WRITES, TIMEOUT_AFTER_WRITE) or recover (NONE). */
export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => setSimulatorFailureMode(db, ctx, params.id, await body()));
