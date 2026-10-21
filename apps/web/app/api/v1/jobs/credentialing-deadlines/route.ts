import { authorize } from "@projectos/core";
import { runCredentialDeadlines } from "@projectos/credentialing";
import { api } from "@/lib/api";

/** Manual trigger (org admins). The worker runs this daily; it is idempotent. */
export const POST = api(async ({ ctx, db }) => {
  await authorize(db, ctx, "org.manage", {}, { action: "job.credentialing_deadlines.run", resourceType: "job" });
  return runCredentialDeadlines(db, { organizationId: ctx.organizationId });
});
