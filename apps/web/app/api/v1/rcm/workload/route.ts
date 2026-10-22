import { ownerWorkload } from "@projectos/rcm";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => {
  const q = req.nextUrl.searchParams.get("queueId");
  return ownerWorkload(db, ctx, { queueId: q && /^[0-9a-f-]{36}$/i.test(q) ? q : undefined });
});
