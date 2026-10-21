import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@projectos/db";
import { memberships, organizations, rolePermissions, roleGrants } from "@projectos/db/schema";
import { isPermission, type Permission } from "@projectos/shared";

export interface Grant {
  permission: Permission;
  siteId: string | null;
  departmentId: string | null;
}

/**
 * Trusted, server-derived request identity. The organization is ALWAYS resolved from the
 * session user's active membership — never from a URL, query string or request body.
 */
export interface AuthContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  displayName: string;
  grants: Grant[];
  requestId?: string;
}

export interface Scope {
  siteId?: string | null;
  departmentId?: string | null;
}

/** Loads the membership + effective grants fresh from the DB for every request (no stale cached roles). */
export async function loadAuthContext(db: DbOrTx, userId: string, requestId?: string): Promise<AuthContext | null> {
  const rows = await db
    .select({ membershipId: memberships.id, organizationId: memberships.organizationId, displayName: memberships.displayName })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "ACTIVE"), eq(organizations.status, "ACTIVE")));
  // Version 1 is single-organization: a user must have exactly one active membership.
  if (rows.length !== 1) return null;
  const m = rows[0]!;
  const grantRows = await db
    .select({ permission: rolePermissions.permission, siteId: roleGrants.siteId, departmentId: roleGrants.departmentId })
    .from(roleGrants)
    .innerJoin(rolePermissions, and(eq(rolePermissions.roleId, roleGrants.roleId), eq(rolePermissions.organizationId, roleGrants.organizationId)))
    .where(and(eq(roleGrants.membershipId, m.membershipId), eq(roleGrants.organizationId, m.organizationId)));
  const grants: Grant[] = grantRows
    .filter((g) => isPermission(g.permission))
    .map((g) => ({ permission: g.permission as Permission, siteId: g.siteId, departmentId: g.departmentId }));
  return { userId, organizationId: m.organizationId, membershipId: m.membershipId, displayName: m.displayName, grants, requestId };
}

const isOrgWide = (g: Grant) => g.siteId === null && g.departmentId === null;

/** Has this permission anywhere (any scope). Use for "may open this area at all". */
export function hasAny(ctx: AuthContext, perm: Permission): boolean {
  return ctx.grants.some((g) => g.permission === perm);
}

/** Has this permission org-wide. */
export function hasOrgWide(ctx: AuthContext, perm: Permission): boolean {
  return ctx.grants.some((g) => g.permission === perm && isOrgWide(g));
}

/**
 * Permission check against a resource's scope. Org-wide grants always match; a site-scoped grant
 * matches only resources at that site; a department-scoped grant only that department.
 * A resource with no site/department requires an org-wide grant.
 */
export function can(ctx: AuthContext, perm: Permission, scope: Scope = {}): boolean {
  return ctx.grants.some(
    (g) =>
      g.permission === perm &&
      (isOrgWide(g) ||
        (g.siteId !== null && scope.siteId != null && g.siteId === scope.siteId) ||
        (g.departmentId !== null && scope.departmentId != null && g.departmentId === scope.departmentId)),
  );
}

export type ScopeFilter = { all: true } | { all: false; siteIds: string[]; departmentIds: string[] };

/** For list queries: which scopes the caller may see for a permission. */
export function scopeFilter(ctx: AuthContext, perm: Permission): ScopeFilter {
  const gs = ctx.grants.filter((g) => g.permission === perm);
  if (gs.some(isOrgWide)) return { all: true };
  return {
    all: false,
    siteIds: [...new Set(gs.flatMap((g) => (g.siteId ? [g.siteId] : [])))],
    departmentIds: [...new Set(gs.flatMap((g) => (g.departmentId ? [g.departmentId] : [])))],
  };
}

export function effectivePermissions(ctx: AuthContext): Permission[] {
  return [...new Set(ctx.grants.map((g) => g.permission))].sort();
}
