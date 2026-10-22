import { undoBulkAssign } from "@projectos/rcm";
import { api } from "@/lib/api";

export const POST = api<{ batchId: string }>(async ({ ctx, db, params }) => undoBulkAssign(db, ctx, params.batchId));
