import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { projects } from "@projectos/db/schema";
import { scopeFilter, type AuthContext } from "@projectos/auth";
import type { Permission } from "@projectos/shared";

/** SQL predicate restricting projects to those the caller may see for `perm`. */
export function projectScopeWhere(ctx: AuthContext, perm: Permission = "projects.read"): SQL {
  const f = scopeFilter(ctx, perm);
  const base = and(eq(projects.organizationId, ctx.organizationId), isNull(projects.deletedAt))!;
  if (f.all) return base;
  const ors: SQL[] = [];
  if (f.siteIds.length) ors.push(inArray(projects.siteId, f.siteIds));
  if (f.departmentIds.length) ors.push(inArray(projects.departmentId, f.departmentIds));
  if (!ors.length) return sql`false`;
  return and(base, or(...ors))!;
}
