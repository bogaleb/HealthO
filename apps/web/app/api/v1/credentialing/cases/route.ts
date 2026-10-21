import { createCase, listCases } from "@projectos/credentialing";
import { api, searchParams } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => listCases(db, ctx, searchParams(req)));
export const POST = api(async ({ ctx, db, body }) => createCase(db, ctx, await body()), { status: 201 });
