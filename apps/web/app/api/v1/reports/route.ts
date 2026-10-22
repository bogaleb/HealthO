import { listMetricDefinitions } from "@projectos/reports";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx }) => listMetricDefinitions(ctx));
