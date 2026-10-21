import { and, eq, type SQL, sql } from "drizzle-orm";
import { qualified, type Db, type DbOrTx } from "@projectos/db";
import { organizations, practitionerSites, practitioners } from "@projectos/db/schema";
import { can, scopeFilter, type AuthContext } from "@projectos/auth";
import { authorize } from "@projectos/core";
import { notFound, type Permission } from "@projectos/shared";

/**
 * Credentialing scope: org-wide grants see every practitioner; site-scoped grants see practitioners
 * affiliated with that site. (Department-scoped credentialing grants do not apply — practitioners
 * are not owned by a department; see ADR-0007.)
 */
export function practitionerScopeWhere(ctx: AuthContext, perm: Permission = "credentialing.read"): SQL {
  const f = scopeFilter(ctx, perm);
  const base = eq(practitioners.organizationId, ctx.organizationId);
  if (f.all) return base;
  if (!f.siteIds.length) return sql`false`;
  return and(
    base,
    sql`exists (select 1 from ${practitionerSites} ps where ps.practitioner_id = ${qualified(practitioners.id)} and ps.site_id in ${f.siteIds})`,
  )!;
}

export async function practitionerSiteIds(db: DbOrTx, ctx: AuthContext, practitionerId: string) {
  const rows = await db
    .select({ siteId: practitionerSites.siteId })
    .from(practitionerSites)
    .where(and(eq(practitionerSites.organizationId, ctx.organizationId), eq(practitionerSites.practitionerId, practitionerId)));
  return rows.map((r) => r.siteId);
}

export function canOnPractitioner(ctx: AuthContext, perm: Permission, siteIds: string[]) {
  return can(ctx, perm, {}) || siteIds.some((s) => can(ctx, perm, { siteId: s }));
}

/** Load a practitioner the caller may read (404 otherwise) and optionally require a further permission. */
export async function loadPractitioner(db: Db, ctx: AuthContext, id: string, require?: { perm: Permission; action: string }) {
  const [p] = await db.select().from(practitioners).where(and(practitionerScopeWhere(ctx), eq(practitioners.id, id)));
  if (!p) throw notFound("Provider");
  const siteIds = await practitionerSiteIds(db, ctx, id);
  if (require && !canOnPractitioner(ctx, require.perm, siteIds)) {
    await authorize(db, ctx, require.perm, {}, { action: require.action, resourceType: "practitioner", resourceId: id });
  }
  return { practitioner: p, siteIds };
}

/** Dual control is ON unless the organization explicitly turns it off. */
export async function dualControlEnabled(db: DbOrTx, organizationId: string) {
  const [o] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, organizationId));
  return (o?.settings as { dualControl?: boolean } | undefined)?.dualControl !== false;
}

