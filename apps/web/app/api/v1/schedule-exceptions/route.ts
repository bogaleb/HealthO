import { AppError } from "@projectos/shared";
import { createException, listExceptions, requireAnywhere } from "@projectos/scheduling";
import { api, searchParams } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => {
  await requireAnywhere(db, ctx, "scheduling.read", "schedule_exception.list", "schedule_exception");
  const q = searchParams(req);
  const from = new Date(q.from ?? Date.now());
  const to = new Date(q.to ?? Date.now() + 60 * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new AppError("VALIDATION_FAILED", "Invalid from/to.");
  return listExceptions(db, ctx, { from, to });
});
export const POST = api(async ({ ctx, db, body }) => createException(db, ctx, await body()), { status: 201 });
