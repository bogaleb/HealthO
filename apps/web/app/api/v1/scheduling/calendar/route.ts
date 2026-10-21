import { getCalendar } from "@projectos/scheduling";
import { api, searchParams } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => getCalendar(db, ctx, searchParams(req)));
