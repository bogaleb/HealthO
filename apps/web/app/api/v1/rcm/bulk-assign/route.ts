import { bulkAssign } from "@projectos/rcm";
import { api } from "@/lib/api";

/** All-or-nothing bulk (re)assignment; returns a batch id that can be undone. */
export const POST = api(async ({ ctx, db, body }) => bulkAssign(db, ctx, await body()));
