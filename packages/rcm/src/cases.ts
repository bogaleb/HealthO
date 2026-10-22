import { and, asc, desc, eq, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { pgConstraint, pgErrorCode, qualified, type Db, type DbOrTx } from "@projectos/db";
import {
  credentialingCases,
  idempotencyKeys,
  memberships,
  payerPlans,
  payers,
  practitioners,
  projects,
  rcmAssignmentBatches,
  rcmCaseActions,
  rcmCases,
  rcmQueues,
  sites,
  tasks,
} from "@projectos/db/schema";
import { hasAny, type AuthContext } from "@projectos/auth";
import { audit, authorize, createTask, getProject, moveTask, parse } from "@projectos/core";
import { enqueueNotification } from "@projectos/notifications";
import {
  AGE_BUCKET_RANGE,
  AppError,
  RCM_AGE_BUCKETS,
  RCM_CASE_STATUSES,
  RCM_CASE_TYPES,
  RCM_CASE_TYPE_LABEL,
  RCM_CLOSED_STATUSES,
  RCM_QUEUE_CATEGORIES,
  TASK_PRIORITIES,
  addDays,
  ageBucket,
  notFound,
  rcmActionCreate,
  rcmAssign,
  rcmBulkAssign,
  rcmCaseCreate,
  rcmCaseUpdate,
  rcmEscalate,
  rcmLinkTask,
  versionConflict,
  type RcmCaseStatus,
} from "@projectos/shared";
import { assertAssignable, canOnCase, caseRef, rcmScopeWhere, requireOnCase, requireWorkable } from "./access";
import { orgToday } from "./queues";

type Row = typeof rcmCases.$inferSelect;
const FIELD_LABEL: Record<string, string> = { nextAction: "next action", nextActionDue: "next-action date", priority: "priority", denialCode: "reason code" };
const isClosed = (s: string) => (RCM_CLOSED_STATUSES as readonly string[]).includes(s);
const OPEN_SQL = sql`${rcmCases.status} not in ('RESOLVED','CLOSED_NO_ACTION')`;

// ------------------------------------------------------------------ list

export const caseListQuery = z.object({
  queueId: z.uuid().optional(),
  category: z.enum(RCM_QUEUE_CATEGORIES).optional(),
  status: z.enum([...RCM_CASE_STATUSES, "OPEN_ANY", "ALL"]).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  caseType: z.enum(RCM_CASE_TYPES).optional(),
  /** uuid, "me" or "none" (unassigned). */
  owner: z.union([z.uuid(), z.enum(["me", "none"])]).optional(),
  /** An age bucket, or "over90" (same definition as the >90-day report). */
  age: z.enum([...RCM_AGE_BUCKETS, "over90"]).optional(),
  /** "overdue" (next action before today), "soon" (today/tomorrow), "none" (no next action date). */
  due: z.enum(["overdue", "soon", "none"]).optional(),
  payerId: z.uuid().optional(),
  siteId: z.uuid().optional(),
  q: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type CaseListQuery = z.input<typeof caseListQuery>;

/** SQL predicate for a parsed case filter (shared with reports so drill-downs reconcile with queue counts). */
export function caseFilterWhere(ctx: AuthContext, q: z.output<typeof caseListQuery>, today: string): SQL {
  const w: SQL[] = [rcmScopeWhere(ctx)];
  if (q.queueId) w.push(eq(rcmCases.queueId, q.queueId));
  if (q.category) w.push(sql`exists (select 1 from rcm_queues rq where rq.id = ${qualified(rcmCases.queueId)} and rq.category = ${q.category})`);
  const st = q.status ?? "OPEN_ANY";
  if (st === "OPEN_ANY") w.push(OPEN_SQL);
  else if (st !== "ALL") w.push(eq(rcmCases.status, st));
  if (q.priority) w.push(eq(rcmCases.priority, q.priority));
  if (q.caseType) w.push(eq(rcmCases.caseType, q.caseType));
  if (q.owner === "me") w.push(eq(rcmCases.ownerUserId, ctx.userId));
  else if (q.owner === "none") w.push(isNull(rcmCases.ownerUserId));
  else if (q.owner) w.push(eq(rcmCases.ownerUserId, q.owner));
  if (q.age === "over90") w.push(sql`${rcmCases.serviceDate} < ${addDays(today, -90)}`);
  else if (q.age) {
    const [min, max] = AGE_BUCKET_RANGE[q.age];
    // age = today - service date  ⇔  service date between today-max and today-min
    w.push(sql`${rcmCases.serviceDate} <= ${addDays(today, -min)}`);
    if (max !== null) w.push(sql`${rcmCases.serviceDate} >= ${addDays(today, -max)}`);
  }
  if (q.due === "overdue") w.push(sql`${rcmCases.nextActionDue} < ${today}`);
  else if (q.due === "soon") w.push(sql`${rcmCases.nextActionDue} between ${today} and ${addDays(today, 1)}`);
  else if (q.due === "none") w.push(isNull(rcmCases.nextActionDue));
  if (q.payerId) w.push(eq(rcmCases.payerId, q.payerId));
  if (q.siteId) w.push(eq(rcmCases.siteId, q.siteId));
  if (q.q) {
    const m = /^RCM-?0*(\d{1,9})$/i.exec(q.q);
    w.push(m ? eq(rcmCases.number, Number(m[1])) : ilike(rcmCases.claimRef, `%${q.q.replace(/[%_\\]/g, "")}%`));
  }
  return and(...w)!;
}

export async function listCases(db: Db, ctx: AuthContext, query: unknown, opts: { now?: Date } = {}) {
  await authorize(db, ctx, "rcm.read", "ANY");
  const q = parse(caseListQuery, query);
  const { today } = await orgToday(db, ctx.organizationId, opts.now);
  const rows = await db
    .select({
      c: rcmCases,
      queueName: rcmQueues.name,
      queueCategory: rcmQueues.category,
      payerName: payers.name,
      planName: payerPlans.name,
      ownerName: memberships.displayName,
      total: sql<number>`count(*) over()`.mapWith(Number),
    })
    .from(rcmCases)
    .innerJoin(rcmQueues, eq(rcmQueues.id, rcmCases.queueId))
    .innerJoin(payers, eq(payers.id, rcmCases.payerId))
    .leftJoin(payerPlans, eq(payerPlans.id, rcmCases.payerPlanId))
    .leftJoin(memberships, and(eq(memberships.userId, rcmCases.ownerUserId), eq(memberships.organizationId, rcmCases.organizationId)))
    .where(caseFilterWhere(ctx, q, today))
    .orderBy(
      sql`case ${rcmCases.priority} when 'URGENT' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end`,
      sql`${rcmCases.nextActionDue} asc nulls last`,
      asc(rcmCases.number),
    )
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  return {
    today,
    page: q.page,
    pageSize: q.pageSize,
    total: rows[0]?.total ?? (q.page === 1 ? 0 : await countCases(db, ctx, q, today)),
    items: rows.map(({ c, total: _t, ...rest }) => decorate(c, rest, today)),
  };
}

async function countCases(db: Db, ctx: AuthContext, q: z.output<typeof caseListQuery>, today: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(rcmCases)
    .where(caseFilterWhere(ctx, q, today));
  return r?.n ?? 0;
}

function decorate<T extends object>(c: Row, extra: T, today: string) {
  const ageDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${c.serviceDate}T00:00:00Z`)) / 86_400_000);
  return {
    ...c,
    ...extra,
    ref: caseRef(c.number),
    ageDays,
    ageBucket: ageBucket(ageDays),
    open: !isClosed(c.status),
    nextActionOverdue: !isClosed(c.status) && !!c.nextActionDue && c.nextActionDue < today,
  };
}

// ------------------------------------------------------------------ detail

async function loadCase(db: DbOrTx, ctx: AuthContext, id: string, lock = false) {
  const q = db
    .select()
    .from(rcmCases)
    .where(and(rcmScopeWhere(ctx), eq(rcmCases.id, id)));
  const [c] = lock ? await q.for("update") : await q;
  if (!c) throw notFound("RCM case");
  return c;
}

export async function getCaseDetail(db: Db, ctx: AuthContext, id: string, opts: { now?: Date } = {}) {
  await authorize(db, ctx, "rcm.read", "ANY");
  if (!z.uuid().safeParse(id).success) throw notFound("RCM case");
  const c = await loadCase(db, ctx, id);
  const { today, timezone } = await orgToday(db, ctx.organizationId, opts.now);
  const [[queue], [payer], [plan], [site], [owner], [prac], [cred], [task]] = await Promise.all([
    db.select().from(rcmQueues).where(eq(rcmQueues.id, c.queueId)),
    db.select({ name: payers.name, code: payers.code }).from(payers).where(eq(payers.id, c.payerId)),
    c.payerPlanId ? db.select({ name: payerPlans.name }).from(payerPlans).where(eq(payerPlans.id, c.payerPlanId)) : Promise.resolve([]),
    c.siteId ? db.select({ name: sites.name, code: sites.code }).from(sites).where(eq(sites.id, c.siteId)) : Promise.resolve([]),
    c.ownerUserId
      ? db
          .select({ name: memberships.displayName })
          .from(memberships)
          .where(and(eq(memberships.userId, c.ownerUserId), eq(memberships.organizationId, c.organizationId)))
      : Promise.resolve([]),
    c.practitionerId ? db.select({ name: practitioners.displayName }).from(practitioners).where(eq(practitioners.id, c.practitionerId)) : Promise.resolve([]),
    c.credentialingCaseId
      ? db
          .select({
            id: credentialingCases.id,
            title: credentialingCases.title,
            status: credentialingCases.status,
            dueDate: credentialingCases.dueDate,
            nextAction: credentialingCases.nextAction,
            completedAt: credentialingCases.completedAt,
          })
          .from(credentialingCases)
          .where(eq(credentialingCases.id, c.credentialingCaseId))
      : Promise.resolve([]),
    c.taskId
      ? db
          .select({ id: tasks.id, number: tasks.number, title: tasks.title, status: tasks.status, projectId: tasks.projectId, projectKey: projects.key })
          .from(tasks)
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .where(eq(tasks.id, c.taskId))
      : Promise.resolve([]),
  ]);
  const actor = sql<
    string | null
  >`(select m.display_name from memberships m where m.user_id = ${qualified(rcmCaseActions.actorUserId)} and m.organization_id = ${qualified(rcmCaseActions.organizationId)})`;
  const toOwner = sql<
    string | null
  >`(select m.display_name from memberships m where m.user_id = ${qualified(rcmCaseActions.toOwnerUserId)} and m.organization_id = ${qualified(rcmCaseActions.organizationId)})`;
  const actions = await db
    .select({ a: rcmCaseActions, actorName: actor, toOwnerName: toOwner })
    .from(rcmCaseActions)
    .where(and(eq(rcmCaseActions.organizationId, ctx.organizationId), eq(rcmCaseActions.caseId, id)))
    .orderBy(desc(rcmCaseActions.at), desc(rcmCaseActions.id));
  const scope = { departmentId: c.departmentId, siteId: c.siteId };
  const canManage = canOnCase(ctx, "rcm.manage", scope);
  const canWork = canManage || (canOnCase(ctx, "rcm.edit", scope) && (!c.ownerUserId || c.ownerUserId === ctx.userId));
  return {
    case: decorate(c, {}, today),
    today,
    timezone,
    queue: queue!,
    payer: payer!,
    plan: plan ?? null,
    site: site ?? null,
    ownerName: owner?.name ?? null,
    practitioner: c.practitionerId ? { id: c.practitionerId, name: prac?.name ?? "Provider", canOpen: hasAny(ctx, "credentialing.read") } : null,
    credentialingCase: cred ?? null,
    task: task ?? null,
    actions: actions.map(({ a, actorName, toOwnerName }) => ({ ...a, actorName: actorName ?? (a.actorSystem ? `System (${a.actorSystem})` : null), toOwnerName })),
    permissions: { canWork, canManage, canClaim: !c.ownerUserId && canOnCase(ctx, "rcm.edit", scope) && !isClosed(c.status) },
  };
}

// ------------------------------------------------------------------ create

export async function createCase(db: Db, ctx: AuthContext, input: unknown, opts: { idempotencyKey?: string; now?: Date } = {}) {
  const d = parse(rcmCaseCreate, input);
  const [queue] = await db
    .select()
    .from(rcmQueues)
    .where(and(eq(rcmQueues.organizationId, ctx.organizationId), eq(rcmQueues.id, d.queueId)));
  if (!queue || !queue.active) throw new AppError("VALIDATION_FAILED", "Choose an active queue.", [{ code: "BAD_QUEUE", field: "queueId" }]);
  const scope = { departmentId: queue.departmentId, siteId: d.siteId ?? null };
  await requireOnCase(db, ctx, "rcm.edit", scope, "rcm.case.create");
  const org = ctx.organizationId;
  const [payer] = await db
    .select({ id: payers.id, name: payers.name })
    .from(payers)
    .where(and(eq(payers.organizationId, org), eq(payers.id, d.payerId)));
  if (!payer) throw new AppError("VALIDATION_FAILED", "Unknown payer.", [{ code: "BAD_LINK", field: "payerId" }]);
  if (d.payerPlanId) {
    const [p] = await db
      .select({ payerId: payerPlans.payerId })
      .from(payerPlans)
      .where(and(eq(payerPlans.organizationId, org), eq(payerPlans.id, d.payerPlanId)));
    if (p?.payerId !== d.payerId) throw new AppError("VALIDATION_FAILED", "That plan does not belong to the selected payer.", [{ code: "BAD_LINK", field: "payerPlanId" }]);
  }
  if (d.siteId) {
    const [s] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.organizationId, org), eq(sites.id, d.siteId)));
    if (!s) throw new AppError("VALIDATION_FAILED", "Unknown site.", [{ code: "BAD_LINK", field: "siteId" }]);
  }
  let practitionerId = d.practitionerId ?? null;
  if (d.credentialingCaseId) {
    // Link, don't copy: the credentialing case stays the single record of the enrollment/licensure blocker.
    const [cc] = await db
      .select({ practitionerId: credentialingCases.practitionerId })
      .from(credentialingCases)
      .where(and(eq(credentialingCases.organizationId, org), eq(credentialingCases.id, d.credentialingCaseId)));
    if (!cc) throw new AppError("VALIDATION_FAILED", "Unknown credentialing case.", [{ code: "BAD_LINK", field: "credentialingCaseId" }]);
    if (practitionerId && practitionerId !== cc.practitionerId)
      throw new AppError("VALIDATION_FAILED", "The credentialing case is for a different provider.", [{ code: "BAD_LINK", field: "credentialingCaseId" }]);
    practitionerId = cc.practitionerId;
  }
  if (practitionerId) {
    const [p] = await db
      .select({ id: practitioners.id })
      .from(practitioners)
      .where(and(eq(practitioners.organizationId, org), eq(practitioners.id, practitionerId)));
    if (!p) throw new AppError("VALIDATION_FAILED", "Unknown provider.", [{ code: "BAD_LINK", field: "practitionerId" }]);
  }
  if (d.ownerUserId) {
    if (d.ownerUserId !== ctx.userId) await requireOnCase(db, ctx, "rcm.manage", scope, "rcm.case.assign");
    await assertAssignable(db, org, d.ownerUserId, [scope]);
  }
  const { today } = await orgToday(db, org, opts.now);
  const now = opts.now ?? new Date();
  const newId = crypto.randomUUID();
  try {
    return await db.transaction(async (tx) => {
      if (opts.idempotencyKey) {
        const ins = await tx
          .insert(idempotencyKeys)
          .values({ organizationId: org, scope: "rcm.case.create", key: opts.idempotencyKey, resourceId: newId })
          .onConflictDoNothing()
          .returning({ id: idempotencyKeys.id });
        if (!ins.length) {
          const [prior] = await tx
            .select({ resourceId: idempotencyKeys.resourceId })
            .from(idempotencyKeys)
            .where(and(eq(idempotencyKeys.organizationId, org), eq(idempotencyKeys.scope, "rcm.case.create"), eq(idempotencyKeys.key, opts.idempotencyKey)));
          const [existing] = await tx.select().from(rcmCases).where(eq(rcmCases.id, prior!.resourceId));
          if (!existing) throw new AppError("CONFLICT", "Idempotency key was already used.");
          return { ...decorate(existing, {}, today), replayed: true };
        }
      }
      const [c] = await tx
        .insert(rcmCases)
        .values({
          id: newId,
          organizationId: org,
          queueId: queue.id,
          departmentId: queue.departmentId,
          siteId: d.siteId ?? null,
          caseType: d.caseType,
          claimRef: d.claimRef,
          payerId: d.payerId,
          payerPlanId: d.payerPlanId ?? null,
          serviceDate: d.serviceDate,
          amountCents: d.amountCents,
          denialCode: d.denialCode ?? null,
          priority: d.priority,
          ownerUserId: d.ownerUserId ?? null,
          nextAction: d.nextAction ?? null,
          // Configurable follow-up date: default from the queue's follow-up interval.
          nextActionDue: d.nextActionDue ?? addDays(today, queue.followUpDays),
          practitionerId,
          credentialingCaseId: d.credentialingCaseId ?? null,
          lastActionAt: now,
          createdBy: ctx.userId,
          createdAt: now,
        })
        .returning();
      await tx.insert(rcmCaseActions).values({
        organizationId: org,
        caseId: c!.id,
        type: "CREATED",
        toStatus: "OPEN",
        toOwnerUserId: c!.ownerUserId,
        nextAction: c!.nextAction,
        nextActionDue: c!.nextActionDue,
        actorUserId: ctx.userId,
        at: now,
      });
      await audit(tx, ctx, {
        action: "rcm.case.create",
        resourceType: "rcm_case",
        resourceId: c!.id,
        metadata: { queueId: queue.id, caseType: d.caseType, ownerUserId: c!.ownerUserId, credentialingCaseId: c!.credentialingCaseId },
      });
      if (c!.ownerUserId && c!.ownerUserId !== ctx.userId) await notifyAssigned(tx, c!, `assigned:${c!.id}:create`);
      return { ...decorate(c!, {}, today), replayed: false };
    });
  } catch (e) {
    if (pgErrorCode(e) === "23505" && pgConstraint(e) === "rcm_cases_open_claim_uq") {
      const [dupe] = await db
        .select({ number: rcmCases.number, id: rcmCases.id })
        .from(rcmCases)
        .where(and(eq(rcmCases.organizationId, org), eq(rcmCases.claimRef, d.claimRef), eq(rcmCases.caseType, d.caseType), OPEN_SQL));
      throw new AppError("CONFLICT", `An open ${RCM_CASE_TYPE_LABEL[d.caseType].toLowerCase()} case already exists for ${d.claimRef}${dupe ? ` (${caseRef(dupe.number)})` : ""}.`, [
        { code: "DUPLICATE_OPEN_CASE", field: "claimRef", message: dupe?.id },
      ]);
    }
    throw e;
  }
}

function notifyAssigned(tx: DbOrTx, c: Row, key: string) {
  return enqueueNotification(tx, {
    organizationId: c.organizationId,
    userId: c.ownerUserId!,
    kind: "RCM_ASSIGNED",
    title: `${caseRef(c.number)} assigned to you`,
    body: `${RCM_CASE_TYPE_LABEL[c.caseType as keyof typeof RCM_CASE_TYPE_LABEL] ?? c.caseType} · next action due ${c.nextActionDue ?? "not set"}`,
    link: `/rcm/cases/${c.id}`,
    resourceType: "rcm_case",
    resourceId: c.id,
    dedupeKey: key,
  });
}

// ------------------------------------------------------------------ update / follow-up

/** Status, priority and next-action edits. Escalation has its own endpoint (it notifies and records a reason). */
export async function updateCase(db: Db, ctx: AuthContext, id: string, input: unknown, opts: { now?: Date } = {}) {
  const { version, resolutionNote, ...d } = parse(rcmCaseUpdate, input);
  const c = await loadCase(db, ctx, id);
  await requireWorkable(db, ctx, c, "rcm.case.update");
  if (d.status === "ESCALATED") throw new AppError("VALIDATION_FAILED", "Use Escalate to escalate a case (a reason is required).", [{ code: "USE_ESCALATE", field: "status" }]);
  const now = opts.now ?? new Date();
  const closing = d.status !== undefined && isClosed(d.status) && !isClosed(c.status);
  const reopening = d.status !== undefined && !isClosed(d.status) && isClosed(c.status);
  if (closing && !resolutionNote) throw new AppError("VALIDATION_FAILED", "Add a short resolution note when closing a case.", [{ code: "REQUIRED", field: "resolutionNote" }]);
  const row = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(rcmCases)
      .set({
        ...d,
        ...(closing ? { resolvedAt: now, resolutionNote } : {}),
        ...(reopening ? { resolvedAt: null, resolutionNote: null } : {}),
        lastActionAt: now,
        version: version + 1,
      })
      .where(and(eq(rcmCases.id, id), eq(rcmCases.version, version)))
      .returning();
    if (!r) throw versionConflict();
    const statusChanged = d.status !== undefined && d.status !== c.status;
    const otherFields = Object.keys(d).filter((k) => k !== "status");
    if (statusChanged)
      await tx.insert(rcmCaseActions).values({
        organizationId: c.organizationId,
        caseId: id,
        type: "STATUS_CHANGED",
        fromStatus: c.status,
        toStatus: d.status,
        note: closing ? resolutionNote : null,
        actorUserId: ctx.userId,
        at: now,
      });
    if (otherFields.length)
      await tx.insert(rcmCaseActions).values({
        organizationId: c.organizationId,
        caseId: id,
        type: "UPDATED",
        note: `Changed ${otherFields.map((f) => FIELD_LABEL[f] ?? f).join(", ")}`,
        nextAction: r.nextAction,
        nextActionDue: r.nextActionDue,
        actorUserId: ctx.userId,
        at: now,
      });
    await audit(tx, ctx, { action: "rcm.case.update", resourceType: "rcm_case", resourceId: id, metadata: { fields: Object.keys(d), status: d.status } });
    return r;
  });
  const taskSync = closing && d.status === "RESOLVED" ? await syncTaskDone(db, ctx, row) : null;
  const { today } = await orgToday(db, ctx.organizationId, opts.now);
  return { ...decorate(row, {}, today), taskSync };
}

/** Resolving a case completes its linked project task — one record of the work, kept in sync. */
async function syncTaskDone(db: Db, ctx: AuthContext, c: Row): Promise<string | null> {
  if (!c.taskId) return null;
  const [t] = await db.select().from(tasks).where(eq(tasks.id, c.taskId));
  if (!t || t.deletedAt || t.status === "DONE") return t?.status === "DONE" ? "DONE" : null;
  try {
    await moveTask(db, ctx, t.id, { status: "DONE", version: t.version });
    return "DONE";
  } catch (e) {
    return e instanceof AppError ? `NOT_SYNCED: ${e.message}` : "NOT_SYNCED";
  }
}

/** Record a follow-up event (call, portal check, appeal…) and usually the next action in the same step. */
export async function addCaseAction(db: Db, ctx: AuthContext, id: string, input: unknown, opts: { now?: Date } = {}) {
  const d = parse(rcmActionCreate, input);
  const pre = await loadCase(db, ctx, id);
  await requireWorkable(db, ctx, pre, "rcm.case.action");
  if (isClosed(pre.status)) throw new AppError("VALIDATION_FAILED", "Reopen the case before recording follow-up.", [{ code: "CLOSED", field: "status" }]);
  const now = opts.now ?? new Date();
  const { today } = await orgToday(db, ctx.organizationId, opts.now);
  const row = await db.transaction(async (tx) => {
    const c = await loadCase(tx, ctx, id, true); // row lock: concurrent follow-ups serialize, none lost
    const [queue] = await tx.select({ followUpDays: rcmQueues.followUpDays }).from(rcmQueues).where(eq(rcmQueues.id, c.queueId));
    const nextAction = d.nextAction !== undefined ? d.nextAction : c.nextAction;
    const nextActionDue = d.nextActionDue !== undefined ? d.nextActionDue : d.nextAction ? addDays(today, queue?.followUpDays ?? 14) : c.nextActionDue;
    const status: RcmCaseStatus = d.status ?? (c.status === "OPEN" ? "IN_PROGRESS" : (c.status as RcmCaseStatus));
    const [r] = await tx
      .update(rcmCases)
      .set({ nextAction, nextActionDue, status, lastActionAt: now, version: c.version + 1 })
      .where(eq(rcmCases.id, id))
      .returning();
    await tx.insert(rcmCaseActions).values({
      organizationId: c.organizationId,
      caseId: id,
      type: d.type,
      note: d.note,
      fromStatus: c.status !== status ? c.status : null,
      toStatus: c.status !== status ? status : null,
      nextAction,
      nextActionDue,
      actorUserId: ctx.userId,
      at: now,
    });
    await audit(tx, ctx, { action: "rcm.case.action", resourceType: "rcm_case", resourceId: id, metadata: { type: d.type, status } });
    return r!;
  });
  return decorate(row, {}, today);
}

// ------------------------------------------------------------------ assignment

/**
 * Single-case assignment. Analysts may claim an unassigned case or release their own; anything else
 * (assigning to someone else, taking over another person's case) needs rcm.manage for the case's scope.
 */
export async function assignCase(db: Db, ctx: AuthContext, id: string, input: unknown, opts: { now?: Date } = {}) {
  const d = parse(rcmAssign, input);
  const c = await loadCase(db, ctx, id);
  const scope = { id, departmentId: c.departmentId, siteId: c.siteId };
  const selfClaim = d.ownerUserId === ctx.userId && (!c.ownerUserId || c.ownerUserId === ctx.userId);
  const selfRelease = d.ownerUserId === null && c.ownerUserId === ctx.userId;
  await requireOnCase(db, ctx, selfClaim || selfRelease ? "rcm.edit" : "rcm.manage", scope, "rcm.case.assign");
  if (isClosed(c.status)) throw new AppError("VALIDATION_FAILED", "Closed cases can't be reassigned.", [{ code: "CLOSED", field: "status" }]);
  if (d.ownerUserId) await assertAssignable(db, ctx.organizationId, d.ownerUserId, [scope]);
  const now = opts.now ?? new Date();
  const row = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(rcmCases)
      .set({ ownerUserId: d.ownerUserId, lastActionAt: now, version: d.version + 1 })
      .where(and(eq(rcmCases.id, id), eq(rcmCases.version, d.version)))
      .returning();
    if (!r) throw versionConflict();
    const [a] = await tx
      .insert(rcmCaseActions)
      .values({ organizationId: c.organizationId, caseId: id, type: "ASSIGNED", fromOwnerUserId: c.ownerUserId, toOwnerUserId: d.ownerUserId, actorUserId: ctx.userId, at: now })
      .returning({ id: rcmCaseActions.id });
    await audit(tx, ctx, { action: "rcm.case.assign", resourceType: "rcm_case", resourceId: id, metadata: { fromOwnerUserId: c.ownerUserId, toOwnerUserId: d.ownerUserId } });
    if (r.ownerUserId && r.ownerUserId !== ctx.userId) await notifyAssigned(tx, r, `assigned:${id}:${a!.id}`);
    return r;
  });
  const { today } = await orgToday(db, ctx.organizationId, opts.now);
  return decorate(row, {}, today);
}

/**
 * Bulk assignment: all-or-nothing in one transaction. Every case must be visible, open and within the caller's
 * rcm.manage scope, and the assignee must be permitted for every case's scope — otherwise nothing changes.
 * The batch is recorded so it can be undone as a unit.
 */
export async function bulkAssign(db: Db, ctx: AuthContext, input: unknown, opts: { now?: Date } = {}) {
  const d = parse(rcmBulkAssign, input);
  const ids = [...new Set(d.caseIds)];
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(rcmCases)
      .where(and(rcmScopeWhere(ctx), inArray(rcmCases.id, ids)))
      .orderBy(asc(rcmCases.id))
      .for("update");
    if (rows.length !== ids.length) throw new AppError("NOT_FOUND", "Some selected cases were not found. Reload and try again.");
    const denied = rows.filter((c) => !canOnCase(ctx, "rcm.manage", c));
    if (denied.length) {
      await audit(db, ctx, { action: "rcm.case.bulk_assign", resourceType: "rcm_case", outcome: "DENY", metadata: { permission: "rcm.manage", count: denied.length } });
      throw new AppError("FORBIDDEN", `You can't assign ${denied.length} of the selected cases (outside your queues). Nothing was changed.`);
    }
    const closed = rows.filter((c) => isClosed(c.status));
    if (closed.length)
      throw new AppError("VALIDATION_FAILED", `Closed cases can't be reassigned: ${closed.map((c) => caseRef(c.number)).join(", ")}. Nothing was changed.`, [
        { code: "CLOSED", field: "caseIds" },
      ]);
    if (d.versions) {
      const stale = rows.filter((c) => d.versions![c.id] !== undefined && d.versions![c.id] !== c.version);
      if (stale.length) throw new AppError("VERSION_CONFLICT", `${stale.map((c) => caseRef(c.number)).join(", ")} changed since you loaded the list. Nothing was changed.`);
    }
    if (d.ownerUserId) await assertAssignable(tx, ctx.organizationId, d.ownerUserId, rows);
    const changing = rows.filter((c) => c.ownerUserId !== d.ownerUserId);
    const [batch] = await tx
      .insert(rcmAssignmentBatches)
      .values({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        ownerUserId: d.ownerUserId,
        items: changing.map((c) => ({ caseId: c.id, previousOwnerUserId: c.ownerUserId, versionAfter: c.version + 1 })),
        caseCount: changing.length,
      })
      .returning();
    for (const c of changing) {
      await tx
        .update(rcmCases)
        .set({ ownerUserId: d.ownerUserId, lastActionAt: now, version: c.version + 1 })
        .where(eq(rcmCases.id, c.id));
    }
    if (changing.length)
      await tx.insert(rcmCaseActions).values(
        changing.map((c) => ({
          organizationId: ctx.organizationId,
          caseId: c.id,
          type: "ASSIGNED",
          note: "Bulk assignment",
          fromOwnerUserId: c.ownerUserId,
          toOwnerUserId: d.ownerUserId,
          batchId: batch!.id,
          actorUserId: ctx.userId,
          at: now,
        })),
      );
    await audit(tx, ctx, {
      action: "rcm.case.bulk_assign",
      resourceType: "rcm_assignment_batch",
      resourceId: batch!.id,
      metadata: { count: changing.length, skipped: rows.length - changing.length, ownerUserId: d.ownerUserId },
    });
    if (d.ownerUserId && d.ownerUserId !== ctx.userId && changing.length)
      await enqueueNotification(tx, {
        organizationId: ctx.organizationId,
        userId: d.ownerUserId,
        kind: "RCM_ASSIGNED",
        title: `${changing.length} RCM case${changing.length === 1 ? "" : "s"} assigned to you`,
        body: changing
          .slice(0, 5)
          .map((c) => caseRef(c.number))
          .join(", "),
        link: "/rcm/queues?owner=me",
        resourceType: "rcm_assignment_batch",
        resourceId: batch!.id,
        dedupeKey: `assigned:batch:${batch!.id}`,
      });
    return { batchId: batch!.id, assigned: changing.length, unchanged: rows.length - changing.length };
  });
}

/** Reverse a bulk assignment — only if none of its cases changed since (otherwise nothing changes). */
export async function undoBulkAssign(db: Db, ctx: AuthContext, batchId: string, opts: { now?: Date } = {}) {
  if (!z.uuid().safeParse(batchId).success) throw notFound("Assignment batch");
  // Phase 8 (privilege matrix): authorize before revealing any batch state, and even for batches with no items.
  await authorize(db, ctx, "rcm.manage", "ANY", { action: "rcm.case.bulk_assign.undo", resourceType: "rcm_assignment_batch", resourceId: batchId });
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const [b] = await tx
      .select()
      .from(rcmAssignmentBatches)
      .where(and(eq(rcmAssignmentBatches.organizationId, ctx.organizationId), eq(rcmAssignmentBatches.id, batchId)))
      .for("update");
    if (!b) throw notFound("Assignment batch");
    if (b.undoneAt) throw new AppError("CONFLICT", "This assignment was already undone.");
    const items = b.items as { caseId: string; previousOwnerUserId: string | null; versionAfter: number }[];
    const rows = items.length
      ? await tx
          .select()
          .from(rcmCases)
          .where(
            and(
              eq(rcmCases.organizationId, ctx.organizationId),
              inArray(
                rcmCases.id,
                items.map((i) => i.caseId),
              ),
            ),
          )
          .orderBy(asc(rcmCases.id))
          .for("update")
      : [];
    const denied = rows.filter((c) => !canOnCase(ctx, "rcm.manage", c));
    if (denied.length) {
      await audit(db, ctx, {
        action: "rcm.case.bulk_assign.undo",
        resourceType: "rcm_assignment_batch",
        resourceId: batchId,
        outcome: "DENY",
        metadata: { permission: "rcm.manage" },
      });
      throw new AppError("FORBIDDEN", "You can't undo this assignment (some cases are outside your queues).");
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const changed = items.filter((i) => byId.get(i.caseId)?.version !== i.versionAfter);
    if (changed.length)
      throw new AppError(
        "CONFLICT",
        `Can't undo: ${changed.map((i) => (byId.get(i.caseId) ? caseRef(byId.get(i.caseId)!.number) : "a case")).join(", ")} changed after the assignment. Nothing was changed.`,
      );
    for (const i of items) {
      await tx
        .update(rcmCases)
        .set({ ownerUserId: i.previousOwnerUserId, lastActionAt: now, version: i.versionAfter + 1 })
        .where(eq(rcmCases.id, i.caseId));
    }
    if (items.length)
      await tx.insert(rcmCaseActions).values(
        items.map((i) => ({
          organizationId: ctx.organizationId,
          caseId: i.caseId,
          type: "ASSIGNED",
          note: "Undo of bulk assignment",
          fromOwnerUserId: b.ownerUserId,
          toOwnerUserId: i.previousOwnerUserId,
          batchId,
          actorUserId: ctx.userId,
          at: now,
        })),
      );
    await tx.update(rcmAssignmentBatches).set({ undoneAt: now, undoneBy: ctx.userId }).where(eq(rcmAssignmentBatches.id, batchId));
    await audit(tx, ctx, { action: "rcm.case.bulk_assign.undo", resourceType: "rcm_assignment_batch", resourceId: batchId, metadata: { count: items.length } });
    return { batchId, restored: items.length };
  });
}

// ------------------------------------------------------------------ escalation

export async function escalateCase(db: Db, ctx: AuthContext, id: string, input: unknown, opts: { now?: Date } = {}) {
  const d = parse(rcmEscalate, input);
  const c = await loadCase(db, ctx, id);
  await requireWorkable(db, ctx, c, "rcm.case.escalate");
  if (isClosed(c.status)) throw new AppError("VALIDATION_FAILED", "Closed cases can't be escalated.", [{ code: "CLOSED", field: "status" }]);
  const [queue] = await db.select().from(rcmQueues).where(eq(rcmQueues.id, c.queueId));
  const to = d.escalateToUserId ?? queue?.leadUserId ?? null;
  if (to) {
    // Escalations go to someone who can act on them: a supervisor (rcm.manage) for this queue.
    const ok = await db.execute<{ ok: boolean }>(sql`
      select exists (
        select 1 from memberships m
        join role_grants g on g.membership_id = m.id and g.organization_id = m.organization_id
        join role_permissions rp on rp.role_id = g.role_id and rp.organization_id = g.organization_id
        where m.organization_id = ${ctx.organizationId} and m.user_id = ${to} and m.status = 'ACTIVE' and rp.permission = 'rcm.manage'
          and ((g.site_id is null and g.department_id is null) or g.department_id = ${c.departmentId} ${c.siteId ? sql`or g.site_id = ${c.siteId}` : sql``})
      ) as ok`);
    if (!ok[0]?.ok) throw new AppError("VALIDATION_FAILED", "Escalate to a revenue-cycle supervisor for this queue.", [{ code: "NOT_A_SUPERVISOR", field: "escalateToUserId" }]);
  }
  const now = opts.now ?? new Date();
  const row = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(rcmCases)
      .set({
        status: "ESCALATED",
        escalatedAt: now,
        priority: c.priority === "LOW" || c.priority === "MEDIUM" ? "HIGH" : c.priority,
        lastActionAt: now,
        version: d.version + 1,
      })
      .where(and(eq(rcmCases.id, id), eq(rcmCases.version, d.version)))
      .returning();
    if (!r) throw versionConflict();
    const [a] = await tx
      .insert(rcmCaseActions)
      .values({
        organizationId: c.organizationId,
        caseId: id,
        type: "ESCALATED",
        note: d.reason,
        fromStatus: c.status,
        toStatus: "ESCALATED",
        toOwnerUserId: to,
        actorUserId: ctx.userId,
        at: now,
      })
      .returning({ id: rcmCaseActions.id });
    await audit(tx, ctx, { action: "rcm.case.escalate", resourceType: "rcm_case", resourceId: id, metadata: { escalateToUserId: to } });
    if (to && to !== ctx.userId)
      await enqueueNotification(tx, {
        organizationId: c.organizationId,
        userId: to,
        kind: "RCM_ESCALATED",
        title: `${caseRef(c.number)} escalated to you`,
        body: d.reason.slice(0, 200),
        link: `/rcm/cases/${id}`,
        resourceType: "rcm_case",
        resourceId: id,
        dedupeKey: `escalated:${id}:${a!.id}`,
      });
    return r;
  });
  const { today } = await orgToday(db, ctx.organizationId, opts.now);
  return { ...decorate(row, {}, today), escalatedTo: to };
}

// ------------------------------------------------------------------ project link

/** Create a project task for this case (normal project permissions apply) and link it. Idempotent per case. */
export async function linkCaseTask(db: Db, ctx: AuthContext, id: string, input: unknown) {
  const c = await loadCase(db, ctx, id);
  await requireWorkable(db, ctx, c, "rcm.case.link_task");
  if (c.taskId) throw new AppError("CONFLICT", "This case already has a linked task.");
  const { projectId } = parse(rcmLinkTask, input);
  await getProject(db, ctx, projectId);
  const [p] = await db.select({ name: payers.name }).from(payers).where(eq(payers.id, c.payerId));
  const { task } = await createTask(
    db,
    ctx,
    {
      projectId,
      title: `${caseRef(c.number)} ${RCM_CASE_TYPE_LABEL[c.caseType as keyof typeof RCM_CASE_TYPE_LABEL] ?? c.caseType} — ${p?.name ?? "payer"}`,
      ownerUserId: c.ownerUserId,
      dueDate: c.nextActionDue,
      labels: ["rcm"],
    },
    { idempotencyKey: `rcm-case-task-${c.id}` },
  );
  const row = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(rcmCases)
      .set({ taskId: task.id, version: c.version + 1 })
      .where(and(eq(rcmCases.id, id), eq(rcmCases.version, c.version), isNull(rcmCases.taskId)))
      .returning();
    if (!r) throw versionConflict();
    await tx.insert(rcmCaseActions).values({ organizationId: c.organizationId, caseId: id, type: "TASK_LINKED", note: `Task #${task.number}`, actorUserId: ctx.userId });
    await audit(tx, ctx, { action: "rcm.case.link_task", resourceType: "rcm_case", resourceId: id, metadata: { taskId: task.id, projectId } });
    return r;
  });
  return { case: row, task };
}

/** Recent bulk batches the caller made (for the "Undo" banner). */
export async function recentBatches(db: Db, ctx: AuthContext, limit = 5) {
  return db
    .select({
      id: rcmAssignmentBatches.id,
      caseCount: rcmAssignmentBatches.caseCount,
      ownerUserId: rcmAssignmentBatches.ownerUserId,
      createdAt: rcmAssignmentBatches.createdAt,
      undoneAt: rcmAssignmentBatches.undoneAt,
      ownerName: memberships.displayName,
    })
    .from(rcmAssignmentBatches)
    .leftJoin(memberships, and(eq(memberships.userId, rcmAssignmentBatches.ownerUserId), eq(memberships.organizationId, rcmAssignmentBatches.organizationId)))
    .where(and(eq(rcmAssignmentBatches.organizationId, ctx.organizationId), eq(rcmAssignmentBatches.actorUserId, ctx.userId)))
    .orderBy(desc(rcmAssignmentBatches.createdAt))
    .limit(limit);
}

/** Open cases that are blocked by an unfinished credentialing case (credentialing ↔ RCM rollup). */
export function credentialingBlockedWhere(): SQL {
  return and(OPEN_SQL, sql`exists (select 1 from credentialing_cases cc where cc.id = ${qualified(rcmCases.credentialingCaseId)} and cc.status not in ('COMPLETED','CANCELLED'))`)!;
}
