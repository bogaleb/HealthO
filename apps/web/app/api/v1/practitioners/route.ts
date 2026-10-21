import { createPractitioner, listPractitioners } from "@projectos/credentialing";
import { api, searchParams } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => listPractitioners(db, ctx, searchParams(req)));
export const POST = api(async ({ ctx, db, body }) => createPractitioner(db, ctx, await body()), { status: 201 });
