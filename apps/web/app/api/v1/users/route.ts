import { listMembers } from "@projectos/core";
import { api, searchParams } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => {
  const sp = searchParams(req);
  return listMembers(db, ctx, { departmentId: sp.departmentId || undefined, status: sp.status || undefined });
});
