import { generateRecurringTasks, authorize } from "@projectos/core";
import { api } from "@/lib/api";

/** Manual trigger for the idempotent recurring-task generator (the worker also runs it). Org admins only. */
export const POST = api(async ({ ctx, db }) => {
  await authorize(db, ctx, "org.manage", {}, { action: "job.recurring.run", resourceType: "job" });
  return generateRecurringTasks(db, { organizationId: ctx.organizationId });
});
