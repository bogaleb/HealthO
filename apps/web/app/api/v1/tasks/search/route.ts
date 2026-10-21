import { searchTasks } from "@projectos/core";
import { api, searchParams } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => {
  const sp = searchParams(req);
  return searchTasks(db, ctx, (sp.q ?? "").slice(0, 100), sp.exclude || undefined);
});
