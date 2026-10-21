import { createEnrollment } from "@projectos/credentialing";
import { api } from "@/lib/api";

export const POST = api(async ({ ctx, db, body }) => createEnrollment(db, ctx, await body()), { status: 201 });
