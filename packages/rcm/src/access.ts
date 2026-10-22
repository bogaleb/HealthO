import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Db, DbOrTx } from "@projectos/db";
import { memberships, rcmCases } from "@projectos/db/schema";
import { can, loadAuthContext, scopeFilter, type AuthContext } from "@projectos/auth";
import { audit } from "@projectos/core";
import { AppError, forbidden, type Permission } from "@projectos/shared";

/**
 * RCM visibility: org-wide grants see everything; department-scoped grants see cases in queues of that department;
 * site-scoped grants see cases recorded against that site. Applied in SQL for every list, report and job.
 */
export function rcmScopeWhere(ctx: AuthContext, perm: Permission = "rcm.read"): SQL {
  const f = scopeFilter(ctx, perm);
  const base = eq(rcmCases.organizationId, ctx.organizationId);
  if (f.all) return base;
  const ors: SQL[] = [];
  if (f.departmentIds.length) ors.push(inArray(rcmCases.departmentId, f.departmentIds));
  if (f.siteIds.length) ors.push(inArray(rcmCases.siteId, f.siteIds));
  if (!ors.length) return sql`false`;
  return and(base, or(...ors))!;
}

export type CaseScope = { departmentId: string; siteId: string | null };

export const canOnCase = (ctx: AuthContext, perm: Permission, c: CaseScope) => can(ctx, perm, { departmentId: c.departmentId, siteId: c.siteId });

/** Throws 403 (and audits the denial) unless the caller holds `perm` for this case's scope. */
export async function requireOnCase(db: Db, ctx: AuthContext, perm: Permission, c: CaseScope & { id?: string }, action: string) {
  if (canOnCase(ctx, perm, c)) return;
  await audit(db, ctx, { action, resourceType: "rcm_case", resourceId: c.id ?? null, outcome: "DENY", metadata: { permission: perm } });
  throw forbidden();
}

/**
 * Field-level rule: analysts (rcm.edit) work cases that are assigned to them or unassigned; supervisors
 * (rcm.manage in scope) may work any case in scope.
 */
export async function requireWorkable(db: Db, ctx: AuthContext, c: CaseScope & { id: string; ownerUserId: string | null }, action: string) {
  if (canOnCase(ctx, "rcm.manage", c)) return;
  await requireOnCase(db, ctx, "rcm.edit", c, action);
  if (c.ownerUserId && c.ownerUserId !== ctx.userId) {
    await audit(db, ctx, { action, resourceType: "rcm_case", resourceId: c.id, outcome: "DENY", metadata: { reason: "not_owner" } });
    throw new AppError("FORBIDDEN", "This case is assigned to someone else. Ask a supervisor to reassign it.");
  }
}

/** The assignee must be an active member who can work RCM cases in this scope (checked against THEIR grants). */
export async function assertAssignable(db: DbOrTx, organizationId: string, userId: string, scopes: CaseScope[]) {
  const [m] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId), eq(memberships.status, "ACTIVE")));
  const actx = m ? await loadAuthContext(db, userId) : null;
  if (!actx || actx.organizationId !== organizationId)
    throw new AppError("VALIDATION_FAILED", "Assignee must be an active member of this organization.", [{ code: "NOT_A_MEMBER", field: "ownerUserId" }]);
  const bad = scopes.filter((s) => !canOnCase(actx, "rcm.edit", s));
  if (bad.length)
    throw new AppError("VALIDATION_FAILED", "The assignee does not have permission to work revenue-cycle cases in this queue's department.", [
      { code: "ASSIGNEE_NOT_PERMITTED", field: "ownerUserId" },
    ]);
}

export const caseRef = (n: number) => `RCM-${String(n).padStart(4, "0")}`;
