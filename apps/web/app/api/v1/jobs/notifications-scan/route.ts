import { authorize } from "@projectos/core";
import { dispatchOutbox, scanTaskDue } from "@projectos/notifications";
import { scanRcmDue } from "@projectos/rcm";
import { api } from "@/lib/api";

/** Manual trigger for the idempotent reminder scan + one outbox dispatch (the worker does this every tick). Org admins only. */
export const POST = api(async ({ ctx, db }) => {
  await authorize(db, ctx, "org.manage", {}, { action: "job.notifications_scan.run", resourceType: "job" });
  const rcm = await scanRcmDue(db, { organizationId: ctx.organizationId });
  const tasks = await scanTaskDue(db, { organizationId: ctx.organizationId });
  const dispatch = await dispatchOutbox(db);
  return { rcm, tasks, dispatch };
});
