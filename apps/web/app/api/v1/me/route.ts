import { eq } from "drizzle-orm";
import { organizations } from "@projectos/db/schema";
import { effectivePermissions } from "@projectos/auth";
import { appMode } from "@projectos/shared";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db }) => {
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name, timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, ctx.organizationId));
  return {
    userId: ctx.userId,
    membershipId: ctx.membershipId,
    displayName: ctx.displayName,
    organization: org,
    permissions: effectivePermissions(ctx),
    grants: ctx.grants,
    mode: appMode(),
  };
});
