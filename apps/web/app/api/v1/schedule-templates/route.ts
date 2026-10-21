import { createTemplate, listTemplates, requireAnywhere } from "@projectos/scheduling";
import { api, searchParams } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => {
  await requireAnywhere(db, ctx, "scheduling.read", "schedule_template.list", "schedule_template");
  const q = searchParams(req);
  return listTemplates(db, ctx, { practitionerId: q.practitionerId, siteId: q.siteId });
});
export const POST = api(async ({ ctx, db, body }) => createTemplate(db, ctx, await body()), { status: 201 });
