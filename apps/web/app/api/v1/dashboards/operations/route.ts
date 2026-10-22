import { getOperationsDashboard } from "@projectos/reports";
import { api, searchParams } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => getOperationsDashboard(db, ctx, searchParams(req)));
