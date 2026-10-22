import { and, asc, eq, sql } from "drizzle-orm";
import { qualified, type Db, type DbOrTx } from "@projectos/db";
import { credentialingCases, departments, memberships, organizations, payerPlans, payers, practitioners, rcmCases, rcmQueues, sites } from "@projectos/db/schema";
import { can, hasAny, scopeFilter, type AuthContext } from "@projectos/auth";
import { audit, authorize, mapDbError, parse } from "@projectos/core";
import { AppError, addDays, notFound, rcmQueueCreate, rcmQueueUpdate, todayIn, versionConflict } from "@projectos/shared";
import { assertAssignable, rcmScopeWhere } from "./access";

export async function orgToday(db: DbOrTx, organizationId: string, now?: Date) {
  const [o] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, organizationId));
  const timezone = o?.tz ?? "America/New_York";
  return { today: todayIn(timezone, now), timezone };
}

/** Queues visible to the caller: any queue whose department (or a site-scoped case) they may read. */
function queueScopeWhere(ctx: AuthContext) {
  const f = scopeFilter(ctx, "rcm.read");
  const base = eq(rcmQueues.organizationId, ctx.organizationId);
  if (f.all) return base;
  const conds = [];
  if (f.departmentIds.length) conds.push(sql`${qualified(rcmQueues.departmentId)} in ${f.departmentIds}`);
  if (f.siteIds.length) conds.push(sql`exists (select 1 from rcm_cases c where c.queue_id = ${qualified(rcmQueues.id)} and c.site_id in ${f.siteIds})`);
  if (!conds.length) return sql`false`;
  return and(base, sql`(${sql.join(conds, sql` or `)})`)!;
}

/**
 * Queue cards with live counts. Every count uses the same scoped predicate as the case list,
 * so clicking a number shows exactly that many rows (see reports reconciliation tests).
 */
export async function listQueues(db: Db, ctx: AuthContext, opts: { now?: Date; includeInactive?: boolean } = {}) {
  await authorize(db, ctx, "rcm.read", "ANY");
  const { today } = await orgToday(db, ctx.organizationId, opts.now);
  const soon = addDays(today, 1);
  const scope = rcmScopeWhere(ctx);
  const open = sql`${rcmCases.status} not in ('RESOLVED','CLOSED_NO_ACTION')`;
  const counts = await db
    .select({
      queueId: rcmCases.queueId,
      open: sql<number>`count(*) filter (where ${open})::int`,
      unassigned: sql<number>`count(*) filter (where ${open} and ${rcmCases.ownerUserId} is null)::int`,
      overdue: sql<number>`count(*) filter (where ${open} and ${rcmCases.nextActionDue} < ${today})::int`,
      dueSoon: sql<number>`count(*) filter (where ${open} and ${rcmCases.nextActionDue} between ${today} and ${soon})::int`,
      aged90: sql<number>`count(*) filter (where ${open} and ${rcmCases.serviceDate} < ${addDays(today, -90)})::int`,
      escalated: sql<number>`count(*) filter (where ${rcmCases.status} = 'ESCALATED')::int`,
      openCents: sql<number>`coalesce(sum(${rcmCases.amountCents}) filter (where ${open}), 0)::bigint`,
      resolved30: sql<number>`count(*) filter (where ${rcmCases.status} = 'RESOLVED' and ${rcmCases.resolvedAt} >= (${addDays(today, -30)})::date)::int`,
    })
    .from(rcmCases)
    .where(scope)
    .groupBy(rcmCases.queueId);
  const byQueue = new Map(counts.map((c) => [c.queueId, c]));
  const queues = await db
    .select({ q: rcmQueues, departmentName: departments.name, leadName: memberships.displayName })
    .from(rcmQueues)
    .innerJoin(departments, eq(departments.id, rcmQueues.departmentId))
    .leftJoin(memberships, and(eq(memberships.userId, rcmQueues.leadUserId), eq(memberships.organizationId, rcmQueues.organizationId)))
    .where(and(queueScopeWhere(ctx), opts.includeInactive ? undefined : eq(rcmQueues.active, true)))
    .orderBy(asc(rcmQueues.name));
  const zero = { open: 0, unassigned: 0, overdue: 0, dueSoon: 0, aged90: 0, escalated: 0, openCents: 0, resolved30: 0 };
  return {
    today,
    computedAt: new Date().toISOString(),
    queues: queues.map(({ q, departmentName, leadName }) => {
      const c = byQueue.get(q.id);
      return {
        ...q,
        departmentName,
        leadName,
        canManage: can(ctx, "rcm.manage", { departmentId: q.departmentId }),
        counts: c ? { ...zero, ...c, openCents: Number(c.openCents) } : zero,
      };
    }),
  };
}

/** Open work per owner (plus an "Unassigned" row) within the caller's scope, optionally for one queue. */
export async function ownerWorkload(db: Db, ctx: AuthContext, opts: { queueId?: string; now?: Date } = {}) {
  await authorize(db, ctx, "rcm.read", "ANY");
  const { today } = await orgToday(db, ctx.organizationId, opts.now);
  const rows = await db
    .select({
      ownerUserId: rcmCases.ownerUserId,
      ownerName: memberships.displayName,
      open: sql<number>`count(*)::int`,
      overdue: sql<number>`count(*) filter (where ${rcmCases.nextActionDue} < ${today})::int`,
      aged90: sql<number>`count(*) filter (where ${rcmCases.serviceDate} < ${addDays(today, -90)})::int`,
      urgent: sql<number>`count(*) filter (where ${rcmCases.priority} in ('HIGH','URGENT'))::int`,
    })
    .from(rcmCases)
    .leftJoin(memberships, and(eq(memberships.userId, rcmCases.ownerUserId), eq(memberships.organizationId, rcmCases.organizationId)))
    .where(and(rcmScopeWhere(ctx), sql`${rcmCases.status} not in ('RESOLVED','CLOSED_NO_ACTION')`, opts.queueId ? eq(rcmCases.queueId, opts.queueId) : undefined))
    .groupBy(rcmCases.ownerUserId, memberships.displayName)
    .orderBy(sql`${memberships.displayName} asc nulls first`);
  return rows;
}

export async function createQueue(db: Db, ctx: AuthContext, input: unknown) {
  const d = parse(rcmQueueCreate, input);
  await authorize(db, ctx, "rcm.manage", { departmentId: d.departmentId }, { action: "rcm.queue.create", resourceType: "rcm_queue" });
  const [dep] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.organizationId, ctx.organizationId), eq(departments.id, d.departmentId)));
  if (!dep) throw notFound("Department");
  if (d.leadUserId) await assertAssignable(db, ctx.organizationId, d.leadUserId, [{ departmentId: d.departmentId, siteId: null }]);
  try {
    return await db.transaction(async (tx) => {
      const [q] = await tx
        .insert(rcmQueues)
        .values({ ...d, organizationId: ctx.organizationId })
        .returning();
      await audit(tx, ctx, { action: "rcm.queue.create", resourceType: "rcm_queue", resourceId: q!.id, metadata: { category: d.category, departmentId: d.departmentId } });
      return q!;
    });
  } catch (e) {
    mapDbError(e, "A queue with this name already exists.");
  }
}

export async function updateQueue(db: Db, ctx: AuthContext, id: string, input: unknown) {
  const { version, departmentId, ...d } = parse(rcmQueueUpdate, input);
  const [q] = await db
    .select()
    .from(rcmQueues)
    .where(and(eq(rcmQueues.organizationId, ctx.organizationId), eq(rcmQueues.id, id)));
  if (!q) throw notFound("Queue");
  await authorize(db, ctx, "rcm.manage", { departmentId: q.departmentId }, { action: "rcm.queue.update", resourceType: "rcm_queue", resourceId: id });
  if (departmentId && departmentId !== q.departmentId)
    throw new AppError("VALIDATION_FAILED", "A queue's department can't change (it decides who can see its cases). Create a new queue instead.", [
      { code: "IMMUTABLE", field: "departmentId" },
    ]);
  if (d.leadUserId) await assertAssignable(db, ctx.organizationId, d.leadUserId, [{ departmentId: q.departmentId, siteId: null }]);
  try {
    return await db.transaction(async (tx) => {
      const [r] = await tx
        .update(rcmQueues)
        .set({ ...d, version: version + 1 })
        .where(and(eq(rcmQueues.id, id), eq(rcmQueues.version, version)))
        .returning();
      if (!r) throw versionConflict();
      await audit(tx, ctx, { action: "rcm.queue.update", resourceType: "rcm_queue", resourceId: id, metadata: { fields: Object.keys(d) } });
      return r;
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    mapDbError(e, "A queue with this name already exists.");
  }
}

/** Members who may be assigned work in a department/site (holders of rcm.edit for that scope). */
export async function assignableMembers(db: Db, ctx: AuthContext, scope: { departmentId: string; siteId?: string | null }, perm: "rcm.edit" | "rcm.manage" = "rcm.edit") {
  if (!hasAny(ctx, "rcm.read")) return [];
  const rows = await db.execute<{ user_id: string; display_name: string }>(sql`
    select distinct m.user_id, m.display_name
    from memberships m
    join role_grants g on g.membership_id = m.id and g.organization_id = m.organization_id
    join role_permissions rp on rp.role_id = g.role_id and rp.organization_id = g.organization_id
    where m.organization_id = ${ctx.organizationId} and m.status = 'ACTIVE' and rp.permission = ${perm}
      and ((g.site_id is null and g.department_id is null) or g.department_id = ${scope.departmentId}
           ${scope.siteId ? sql`or g.site_id = ${scope.siteId}` : sql``})
    order by m.display_name`);
  return rows.map((r) => ({ userId: r.user_id, displayName: r.display_name }));
}

/**
 * Reference data for RCM forms/filters. Credentialing cases are exposed as minimal operational metadata
 * (title, provider display name, status) so RCM can LINK to the blocker instead of copying it.
 */
export async function rcmReference(db: Db, ctx: AuthContext) {
  await authorize(db, ctx, "rcm.read", "ANY");
  const org = ctx.organizationId;
  const [payerRows, planRows, siteRows, deptRows, credRows] = await Promise.all([
    db.select({ id: payers.id, name: payers.name, code: payers.code }).from(payers).where(eq(payers.organizationId, org)).orderBy(asc(payers.name)),
    db.select({ id: payerPlans.id, payerId: payerPlans.payerId, name: payerPlans.name }).from(payerPlans).where(eq(payerPlans.organizationId, org)).orderBy(asc(payerPlans.name)),
    db
      .select({ id: sites.id, name: sites.name, code: sites.code })
      .from(sites)
      .where(and(eq(sites.organizationId, org), eq(sites.active, true)))
      .orderBy(asc(sites.name)),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.organizationId, org)).orderBy(asc(departments.name)),
    db
      .select({ id: credentialingCases.id, title: credentialingCases.title, status: credentialingCases.status, provider: practitioners.displayName })
      .from(credentialingCases)
      .innerJoin(practitioners, eq(practitioners.id, credentialingCases.practitionerId))
      .where(and(eq(credentialingCases.organizationId, org), sql`${credentialingCases.status} not in ('COMPLETED','CANCELLED')`))
      .orderBy(asc(credentialingCases.title)),
  ]);
  return {
    payers: payerRows,
    plans: planRows,
    sites: siteRows,
    departments: deptRows.filter((d) => can(ctx, "rcm.manage", { departmentId: d.id })),
    credentialingCases: credRows,
  };
}
