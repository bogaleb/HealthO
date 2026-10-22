import { getMetricReport } from "@projectos/reports";
import { api, searchParams } from "@/lib/api";

export const GET = api<{ metric: string }>(async ({ ctx, db, params, req }) => getMetricReport(db, ctx, params.metric, searchParams(req)));
