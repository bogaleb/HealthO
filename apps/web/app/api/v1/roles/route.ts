import { createRole, listRoles } from "@projectos/core";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db }) => listRoles(db, ctx));
export const POST = api(async ({ ctx, db, body }) => createRole(db, ctx, await body()), { status: 201 });
