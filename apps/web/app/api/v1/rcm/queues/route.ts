import { createQueue, listQueues } from "@projectos/rcm";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => listQueues(db, ctx, { includeInactive: req.nextUrl.searchParams.get("includeInactive") === "true" }));
export const POST = api(async ({ ctx, db, body }) => createQueue(db, ctx, await body()), { status: 201 });
