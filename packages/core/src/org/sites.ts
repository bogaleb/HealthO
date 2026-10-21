import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@projectos/db";
import { departments, sites, teams } from "@projectos/db/schema";
import { hasAny, scopeFilter, type AuthContext } from "@projectos/auth";
import { AppError, departmentCreate, notFound, siteCreate, siteUpdate, teamCreate, versionConflict } from "@projectos/shared";
import { audit } from "../audit";
import { authorize } from "../authz";
import { mapDbError, parse } from "../util";

export type SiteRow = typeof sites.$inferSelect;

/** Any active member may see the org's site directory (non-sensitive reference data). */
export async function listSites(db: Db, ctx: AuthContext, opts: { includeInactive?: boolean } = {}) {
  const where = [eq(sites.organizationId, ctx.organizationId)];
  if (!opts.includeInactive) where.push(eq(sites.active, true));
  return db.select().from(sites).where(and(...where)).orderBy(asc(sites.code));
}

export async function getSite(db: Db, ctx: AuthContext, id: string) {
  const [row] = await db.select().from(sites).where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.id, id)));
  if (!row) throw notFound("Site");
  return row;
}

export async function createSite(db: Db, ctx: AuthContext, input: unknown) {
  await authorize(db, ctx, "sites.manage", {}, { action: "site.create", resourceType: "site" });
  const data = parse(siteCreate, input);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(sites)
        .values({ ...data, organizationId: ctx.organizationId, createdBy: ctx.userId })
        .returning();
      await audit(tx, ctx, { action: "site.create", resourceType: "site", resourceId: row!.id, metadata: { code: row!.code } });
      return row!;
    });
  } catch (e) {
    mapDbError(e, "A site with this code already exists.");
  }
}

export async function updateSite(db: Db, ctx: AuthContext, id: string, input: unknown) {
  const existing = await getSite(db, ctx, id);
  await authorize(db, ctx, "sites.manage", { siteId: existing.id }, { action: "site.update", resourceType: "site", resourceId: id });
  const { version, ...patch } = parse(siteUpdate, input);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(sites)
        .set({ ...patch, version: existing.version + 1 })
        .where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.id, id), eq(sites.version, version)))
        .returning();
      if (!row) throw versionConflict();
      await audit(tx, ctx, { action: "site.update", resourceType: "site", resourceId: id, metadata: { fields: Object.keys(patch) } });
      return row;
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    mapDbError(e, "A site with this code already exists.");
  }
}

export async function listDepartments(db: Db, ctx: AuthContext) {
  return db.select().from(departments).where(eq(departments.organizationId, ctx.organizationId)).orderBy(asc(departments.name));
}

export async function createDepartment(db: Db, ctx: AuthContext, input: unknown) {
  await authorize(db, ctx, "sites.manage", {}, { action: "department.create", resourceType: "department" });
  const data = parse(departmentCreate, input);
  if (data.siteId) await getSite(db, ctx, data.siteId);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(departments).values({ ...data, organizationId: ctx.organizationId }).returning();
      await audit(tx, ctx, { action: "department.create", resourceType: "department", resourceId: row!.id });
      return row!;
    });
  } catch (e) {
    mapDbError(e, "A department with this code already exists.");
  }
}

export async function listTeams(db: Db, ctx: AuthContext) {
  return db.select().from(teams).where(eq(teams.organizationId, ctx.organizationId)).orderBy(asc(teams.name));
}

export async function createTeam(db: Db, ctx: AuthContext, input: unknown) {
  await authorize(db, ctx, "sites.manage", {}, { action: "team.create", resourceType: "team" });
  const data = parse(teamCreate, input);
  const [dept] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.organizationId, ctx.organizationId), eq(departments.id, data.departmentId)));
  if (!dept) throw notFound("Department");
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(teams).values({ ...data, organizationId: ctx.organizationId }).returning();
      await audit(tx, ctx, { action: "team.create", resourceType: "team", resourceId: row!.id });
      return row!;
    });
  } catch (e) {
    mapDbError(e, "A team with this name already exists in the department.");
  }
}

/** Validates that site/department IDs belong to the caller's organization (prevents cross-org references). */
export async function assertOrgScopeRefs(db: Db, ctx: AuthContext, ref: { siteId?: string | null; departmentId?: string | null }) {
  if (ref.siteId) {
    const r = await db.select({ id: sites.id }).from(sites).where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.id, ref.siteId)));
    if (!r.length) throw new AppError("VALIDATION_FAILED", "Unknown site.", [{ code: "UNKNOWN_SITE", field: "siteId" }]);
  }
  if (ref.departmentId) {
    const r = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.organizationId, ctx.organizationId), eq(departments.id, ref.departmentId)));
    if (!r.length) throw new AppError("VALIDATION_FAILED", "Unknown department.", [{ code: "UNKNOWN_DEPARTMENT", field: "departmentId" }]);
  }
}

/** Sites the caller may manage (for UI affordances); server still re-checks per mutation. */
export function manageableSiteIds(ctx: AuthContext, all: SiteRow[]): string[] {
  if (!hasAny(ctx, "sites.manage")) return [];
  const f = scopeFilter(ctx, "sites.manage");
  return f.all ? all.map((s) => s.id) : all.filter((s) => f.siteIds.includes(s.id)).map((s) => s.id);
}

