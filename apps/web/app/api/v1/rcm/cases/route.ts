import { createCase, listCases } from "@projectos/rcm";
import { api, searchParams } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => listCases(db, ctx, searchParams(req)));
/** Optional `Idempotency-Key` header: a retried create returns the original case instead of a duplicate. */
export const POST = api(async ({ ctx, db, req, body }) => createCase(db, ctx, await body(), { idempotencyKey: req.headers.get("idempotency-key") ?? undefined }), { status: 201 });
