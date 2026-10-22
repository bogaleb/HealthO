import { downtimeSchedule } from "@projectos/scheduling";
import { api, searchParams } from "@/lib/api";

/** Paper downtime schedule for a site (audited as an export). */
export const GET = api(async ({ ctx, db, req }) => downtimeSchedule(db, ctx, searchParams(req)));
