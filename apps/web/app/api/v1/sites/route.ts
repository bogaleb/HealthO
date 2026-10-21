import { createSite, listSites } from "@projectos/core";
import { api, searchParams } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => listSites(db, ctx, { includeInactive: searchParams(req).includeInactive === "true" }));
export const POST = api(async ({ ctx, db, body }) => createSite(db, ctx, await body()), { status: 201 });
