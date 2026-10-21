import { authorize } from "@projectos/core";
import { listReference } from "@projectos/credentialing";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db }) => {
  await authorize(db, ctx, "credentialing.read", "ANY");
  return listReference(db, ctx);
});
