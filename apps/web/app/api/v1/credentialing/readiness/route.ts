import { getReadinessMatrix } from "@projectos/credentialing";
import { api, searchParams } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => getReadinessMatrix(db, ctx, searchParams(req)));
