import { listAuditEvents } from "@projectos/core";
import { api, searchParams } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => listAuditEvents(db, ctx, searchParams(req)));
