import { and, asc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { qualified, type Db, type Tx } from "@projectos/db";
import {
  practitionerServices,
  practitionerSites,
  practitionerSpecialties,
  practitioners,
  professionalAuthorities,
  providerEnrollments,
  services,
  sites,
  specialties,
} from "@projectos/db/schema";
import { hasAny, type AuthContext } from "@projectos/auth";
import { audit, authorize, parse } from "@projectos/core";
import { AppError, PROFESSIONS, US_JURISDICTIONS, addDays, practitionerCreate, practitionerUpdate, todayIn, versionConflict } from "@projectos/shared";
import { canOnPractitioner, loadPractitioner, practitionerScopeWhere } from "./access";

const listQuery = z.object({
  profession: z.enum(PROFESSIONS).optional(),
  state: z.enum(US_JURISDICTIONS).optional(),
  siteId: z.uuid().optional(),
  q: z.string().trim().max(80).optional(),
  includeInactive: z.enum(["true", "false"]).optional(),
});

export async function listReference(db: Db, ctx: AuthContext) {
  const [spec, svc, st] = await Promise.all([
    db.select().from(specialties).where(eq(specialties.organizationId, ctx.organizationId)).orderBy(asc(specialties.name)),
    db
      .select()
      .from(services)
      .where(and(eq(services.organizationId, ctx.organizationId), eq(services.active, true)))
      .orderBy(asc(services.name)),
    db
      .select({ id: sites.id, code: sites.code, name: sites.name, state: sites.state })
      .from(sites)
      .where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.active, true)))
      .orderBy(asc(sites.code)),
  ]);
  return { specialties: spec, services: svc, sites: st };
}

export async function listPractitioners(db: Db, ctx: AuthContext, query: unknown) {
  await authorize(db, ctx, "credentialing.read", "ANY");
  const q = parse(listQuery, query);
  const today = todayIn("America/New_York");
  const soon = addDays(today, 90);
  const where: SQL[] = [practitionerScopeWhere(ctx)];
  if (q.includeInactive !== "true") where.push(eq(practitioners.active, true));
  if (q.profession) where.push(eq(practitioners.profession, q.profession));
  if (q.siteId) where.push(sql`exists (select 1 from practitioner_sites ps where ps.practitioner_id = ${qualified(practitioners.id)} and ps.site_id = ${q.siteId})`);
  if (q.state)
    where.push(
      sql`exists (select 1 from professional_authorities a where a.practitioner_id = ${qualified(practitioners.id)} and a.jurisdiction = ${q.state} and a.authority_type <> 'COMPACT_MEMBERSHIP_CLAIM')`,
    );
  if (q.q) where.push(ilike(practitioners.displayName, `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
  const rows = await db
    .select({
      p: practitioners,
      siteCodes: sql<
        string[]
      >`coalesce((select array_agg(s.code order by s.code) from practitioner_sites ps join sites s on s.id = ps.site_id where ps.practitioner_id = ${qualified(practitioners.id)}), '{}')`,
      verifiedStates: sql<
        string[]
      >`coalesce((select array_agg(distinct a.jurisdiction order by a.jurisdiction) from professional_authorities a where a.practitioner_id = ${qualified(practitioners.id)} and a.status = 'VERIFIED' and a.authority_type <> 'COMPACT_MEMBERSHIP_CLAIM' and (a.expires_on is null or a.expires_on >= ${today})), '{}')`,
      expiringSoon: sql<number>`(select count(*)::int from professional_authorities a where a.practitioner_id = ${qualified(practitioners.id)} and a.status = 'VERIFIED' and a.expires_on between ${today} and ${soon})`,
      expired: sql<number>`(select count(*)::int from professional_authorities a where a.practitioner_id = ${qualified(practitioners.id)} and (a.status = 'EXPIRED' or (a.status = 'VERIFIED' and a.expires_on < ${today})))`,
      pendingReview: sql<number>`(select count(*)::int from professional_authorities a where a.practitioner_id = ${qualified(practitioners.id)} and a.status = 'SUBMITTED')`,
      suspended: sql<number>`(select count(*)::int from professional_authorities a where a.practitioner_id = ${qualified(practitioners.id)} and a.status in ('SUSPENDED','REVOKED'))`,
      enrollmentsReady: sql<number>`(select count(*)::int from provider_enrollments e where e.practitioner_id = ${qualified(practitioners.id)} and e.status = 'APPROVED' and e.verified_at is not null)`,
    })
    .from(practitioners)
    .where(and(...where))
    .orderBy(asc(practitioners.displayName));
  return rows.map(({ p, ...rest }) => ({ ...p, ...rest }));
}

export async function getPractitionerDetail(db: Db, ctx: AuthContext, id: string) {
  const { practitioner, siteIds } = await loadPractitioner(db, ctx, id);
  const [specRows, svcRows, auths, enrolls] = await Promise.all([
    db.select({ id: practitionerSpecialties.specialtyId }).from(practitionerSpecialties).where(eq(practitionerSpecialties.practitionerId, id)),
    db.select({ id: practitionerServices.serviceId }).from(practitionerServices).where(eq(practitionerServices.practitionerId, id)),
    db
      .select()
      .from(professionalAuthorities)
      .where(and(eq(professionalAuthorities.organizationId, ctx.organizationId), eq(professionalAuthorities.practitionerId, id)))
      .orderBy(asc(professionalAuthorities.jurisdiction)),
    db
      .select()
      .from(providerEnrollments)
      .where(and(eq(providerEnrollments.organizationId, ctx.organizationId), eq(providerEnrollments.practitionerId, id))),
  ]);
  return {
    practitioner,
    siteIds,
    specialtyIds: specRows.map((r) => r.id),
    serviceIds: svcRows.map((r) => r.id),
    authorities: auths,
    enrollments: enrolls,
    permissions: {
      edit: canOnPractitioner(ctx, "credentialing.edit", siteIds),
      approve: canOnPractitioner(ctx, "credentialing.approve", siteIds),
    },
  };
}

async function assertRefs(tx: Tx | Db, ctx: AuthContext, ids: { siteIds?: string[]; specialtyIds?: string[]; serviceIds?: string[] }) {
  const check = async (table: typeof sites | typeof specialties | typeof services, list: string[] | undefined, label: string) => {
    if (!list?.length) return;
    const found = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.organizationId, ctx.organizationId), inArray(table.id, list)));
    if (found.length !== new Set(list).size) throw new AppError("VALIDATION_FAILED", `Unknown ${label}.`, [{ code: "UNKNOWN_REF", field: label }]);
  };
  await check(sites, ids.siteIds, "siteIds");
  await check(specialties, ids.specialtyIds, "specialtyIds");
  await check(services, ids.serviceIds, "serviceIds");
}

async function replaceLinks(tx: Tx, ctx: AuthContext, practitionerId: string, d: { siteIds?: string[]; specialtyIds?: string[]; serviceIds?: string[] }) {
  const o = ctx.organizationId;
  if (d.siteIds) {
    await tx.delete(practitionerSites).where(eq(practitionerSites.practitionerId, practitionerId));
    if (d.siteIds.length) await tx.insert(practitionerSites).values([...new Set(d.siteIds)].map((siteId) => ({ organizationId: o, practitionerId, siteId })));
  }
  if (d.specialtyIds) {
    await tx.delete(practitionerSpecialties).where(eq(practitionerSpecialties.practitionerId, practitionerId));
    if (d.specialtyIds.length)
      await tx.insert(practitionerSpecialties).values([...new Set(d.specialtyIds)].map((specialtyId) => ({ organizationId: o, practitionerId, specialtyId })));
  }
  if (d.serviceIds) {
    await tx.delete(practitionerServices).where(eq(practitionerServices.practitionerId, practitionerId));
    if (d.serviceIds.length) await tx.insert(practitionerServices).values([...new Set(d.serviceIds)].map((serviceId) => ({ organizationId: o, practitionerId, serviceId })));
  }
}

export async function createPractitioner(db: Db, ctx: AuthContext, input: unknown) {
  const d = parse(practitionerCreate, input);
  // Creating at a site requires edit rights there (or org-wide).
  if (!canOnPractitioner(ctx, "credentialing.edit", d.siteIds) || (!d.siteIds.length && !hasAny(ctx, "credentialing.edit"))) {
    await authorize(db, ctx, "credentialing.edit", {}, { action: "practitioner.create", resourceType: "practitioner" });
  }
  await assertRefs(db, ctx, d);
  return db.transaction(async (tx) => {
    const { siteIds, specialtyIds, serviceIds, ...values } = d;
    const [p] = await tx
      .insert(practitioners)
      .values({ ...values, organizationId: ctx.organizationId, createdBy: ctx.userId })
      .returning();
    await replaceLinks(tx, ctx, p!.id, { siteIds, specialtyIds, serviceIds });
    await audit(tx, ctx, { action: "practitioner.create", resourceType: "practitioner", resourceId: p!.id, metadata: { profession: p!.profession } });
    return p!;
  });
}

export async function updatePractitioner(db: Db, ctx: AuthContext, id: string, input: unknown) {
  await loadPractitioner(db, ctx, id, { perm: "credentialing.edit", action: "practitioner.update" });
  const { version, siteIds, specialtyIds, serviceIds, ...patch } = parse(practitionerUpdate, input);
  await assertRefs(db, ctx, { siteIds, specialtyIds, serviceIds });
  if (siteIds && !canOnPractitioner(ctx, "credentialing.edit", siteIds)) {
    await authorize(db, ctx, "credentialing.edit", {}, { action: "practitioner.update", resourceType: "practitioner", resourceId: id });
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(practitioners)
      .set({ ...patch, version: version + 1 })
      .where(and(eq(practitioners.id, id), eq(practitioners.organizationId, ctx.organizationId), eq(practitioners.version, version)))
      .returning();
    if (!row) throw versionConflict();
    await replaceLinks(tx, ctx, id, { siteIds, specialtyIds, serviceIds });
    await audit(tx, ctx, {
      action: "practitioner.update",
      resourceType: "practitioner",
      resourceId: id,
      metadata: { fields: [...Object.keys(patch), ...(siteIds ? ["siteIds"] : []), ...(specialtyIds ? ["specialtyIds"] : []), ...(serviceIds ? ["serviceIds"] : [])] },
    });
    return row;
  });
}
