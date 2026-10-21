import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db, DbOrTx } from "@projectos/db";
import { rolePermissions, roleGrants, roles } from "@projectos/db/schema";
import { hasOrgWide, type AuthContext } from "@projectos/auth";
import { AppError, ORG_WIDE_ONLY, isPermission, notFound, roleCreate, roleUpdate, versionConflict, type Permission } from "@projectos/shared";
import { audit } from "../audit";
import { authorize } from "../authz";
import { mapDbError, parse } from "../util";

export interface RoleWithPermissions {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  version: number;
  permissions: Permission[];
  memberCount: number;
}

export async function listRoles(db: DbOrTx, ctx: AuthContext): Promise<RoleWithPermissions[]> {
  const rs = await db.select().from(roles).where(eq(roles.organizationId, ctx.organizationId)).orderBy(asc(roles.name));
  if (!rs.length) return [];
  const ids = rs.map((r) => r.id);
  const perms = await db
    .select()
    .from(rolePermissions)
    .where(and(eq(rolePermissions.organizationId, ctx.organizationId), inArray(rolePermissions.roleId, ids)));
  const grants = await db
    .select({ roleId: roleGrants.roleId, membershipId: roleGrants.membershipId })
    .from(roleGrants)
    .where(and(eq(roleGrants.organizationId, ctx.organizationId), inArray(roleGrants.roleId, ids)));
  return rs.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    version: r.version,
    permissions: perms
      .filter((p) => p.roleId === r.id && isPermission(p.permission))
      .map((p) => p.permission as Permission)
      .sort(),
    memberCount: new Set(grants.filter((g) => g.roleId === r.id).map((g) => g.membershipId)).size,
  }));
}

/** An actor can only hand out permissions they themselves hold org-wide. */
export function assertNoEscalation(ctx: AuthContext, perms: Iterable<Permission>) {
  const missing = [...perms].filter((p) => !hasOrgWide(ctx, p));
  if (missing.length) {
    throw new AppError(
      "ROLE_ESCALATION",
      "You cannot grant permissions you do not hold organization-wide.",
      missing.map((p) => ({ code: "NOT_HELD", field: p })),
    );
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);

export async function createRole(db: Db, ctx: AuthContext, input: unknown) {
  await authorize(db, ctx, "org.manage", {}, { action: "role.create", resourceType: "role" });
  const data = parse(roleCreate, input);
  assertNoEscalation(ctx, data.permissions);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(roles)
        .values({ organizationId: ctx.organizationId, key: `custom_${slug(data.name)}`, name: data.name, description: data.description ?? null })
        .returning();
      if (data.permissions.length) {
        await tx.insert(rolePermissions).values([...new Set(data.permissions)].map((p) => ({ organizationId: ctx.organizationId, roleId: row!.id, permission: p })));
      }
      await audit(tx, ctx, { action: "role.create", resourceType: "role", resourceId: row!.id, metadata: { permissions: data.permissions } });
      return row!;
    });
  } catch (e) {
    mapDbError(e, "A role with this name already exists.");
  }
}

export async function updateRole(db: Db, ctx: AuthContext, id: string, input: unknown) {
  await authorize(db, ctx, "org.manage", {}, { action: "role.update", resourceType: "role", resourceId: id });
  const data = parse(roleUpdate, input);
  const [existing] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.organizationId, ctx.organizationId), eq(roles.id, id)));
  if (!existing) throw notFound("Role");
  if (existing.isSystem) throw new AppError("FORBIDDEN", "Built-in roles cannot be edited. Create a custom role instead.");
  if (data.permissions) assertNoEscalation(ctx, data.permissions);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(roles)
      .set({
        ...(data.name ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        version: existing.version + 1,
      })
      .where(and(eq(roles.id, id), eq(roles.organizationId, ctx.organizationId), eq(roles.version, data.version)))
      .returning();
    if (!row) throw versionConflict();
    if (data.permissions) {
      // A permission that is org-wide-only cannot remain on a role currently granted with a narrower scope.
      const scoped = await tx
        .select({ id: roleGrants.id, siteId: roleGrants.siteId, departmentId: roleGrants.departmentId })
        .from(roleGrants)
        .where(and(eq(roleGrants.organizationId, ctx.organizationId), eq(roleGrants.roleId, id)));
      if (scoped.some((g) => g.siteId || g.departmentId) && data.permissions.some((p) => ORG_WIDE_ONLY.includes(p))) {
        throw new AppError("VALIDATION_FAILED", "This role is granted with a site/department scope; org-wide-only permissions cannot be added.");
      }
      await tx.delete(rolePermissions).where(and(eq(rolePermissions.organizationId, ctx.organizationId), eq(rolePermissions.roleId, id)));
      if (data.permissions.length) {
        await tx.insert(rolePermissions).values([...new Set(data.permissions)].map((p) => ({ organizationId: ctx.organizationId, roleId: id, permission: p })));
      }
    }
    await audit(tx, ctx, {
      action: "role.update",
      resourceType: "role",
      resourceId: id,
      metadata: { fields: Object.keys(data).filter((k) => k !== "version"), permissions: data.permissions },
    });
    return row;
  });
}
