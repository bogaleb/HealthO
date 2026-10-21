import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, ilike, isNull, lt, lte, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { Db, Tx } from "@projectos/db";
import {
  checklistItems,
  idempotencyKeys,
  memberships,
  milestones,
  projects,
  taskCollaborators,
  taskComments,
  taskDependencies,
  taskEvents,
  tasks,
} from "@projectos/db/schema";
import { can, type AuthContext } from "@projectos/auth";
import {
  AppError,
  checklistCreate,
  checklistUpdate,
  commentCreate,
  dependencyCreate,
  notFound,
  taskCreate,
  taskListQuery,
  taskMove,
  taskUpdate,
  todayIn,
  versionConflict,
  type TaskStatus,
} from "@projectos/shared";
import { audit } from "../audit";
import { authorize } from "../authz";
import { parse } from "../util";
import { assertMember, getProject } from "./projects";
import { projectScopeWhere } from "./scope";

export type TaskRow = typeof tasks.$inferSelect;

/** SQL: task has at least one unfinished BLOCKS dependency. */
export const isBlockedSql = sql<boolean>`exists (
  select 1 from task_dependencies d join tasks b on b.id = d.blocking_task_id
  where d.blocked_task_id = ${tasks.id} and d.kind = 'BLOCKS' and b.deleted_at is null and b.status not in ('DONE','CANCELLED'))`;

const ownerName = sql<string | null>`(select m.display_name from memberships m where m.user_id = ${tasks.ownerUserId} and m.organization_id = ${tasks.organizationId})`;

async function loadTaskWithProject(db: Db | Tx, ctx: AuthContext, taskId: string) {
  const [row] = await db
    .select({ task: tasks, project: projects })
    .from(tasks)
    .innerJoin(projects, and(eq(projects.id, tasks.projectId), eq(projects.organizationId, tasks.organizationId)))
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, ctx.organizationId), isNull(tasks.deletedAt), projectScopeWhere(ctx)));
  if (!row) throw notFound("Task");
  return row;
}

async function requireTaskEdit(db: Db, ctx: AuthContext, taskId: string, action: string) {
  const row = await loadTaskWithProject(db, ctx, taskId);
  await authorize(db, ctx, "projects.edit", { siteId: row.project.siteId, departmentId: row.project.departmentId }, { action, resourceType: "task", resourceId: taskId });
  return row;
}

async function event(tx: Tx, ctx: AuthContext, taskId: string, type: string, fromValue?: string | null, toValue?: string | null) {
  await tx.insert(taskEvents).values({ organizationId: ctx.organizationId, taskId, actorUserId: ctx.userId, type, fromValue: fromValue ?? null, toValue: toValue ?? null });
}

async function assertCollaborators(db: Db, ctx: AuthContext, ids: string[] | undefined) {
  for (const id of ids ?? []) await assertMember(db, ctx, id, "collaboratorUserIds");
}

async function endOfColumnPosition(tx: Tx, projectId: string, status: string) {
  const [r] = await tx
    .select({ max: sql<number | null>`max(${tasks.position})` })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.status, status), isNull(tasks.deletedAt)));
  return (r?.max ?? 0) + 1024;
}

export async function createTask(db: Db, ctx: AuthContext, input: unknown, opts: { idempotencyKey?: string } = {}) {
  const data = parse(taskCreate, input);
  const project = await getProject(db, ctx, data.projectId);
  await authorize(db, ctx, "projects.edit", { siteId: project.siteId, departmentId: project.departmentId }, { action: "task.create", resourceType: "task" });
  await assertMember(db, ctx, data.ownerUserId);
  await assertCollaborators(db, ctx, data.collaboratorUserIds);
  let depth = 0;
  if (data.parentTaskId) {
    const parent = await loadTaskWithProject(db, ctx, data.parentTaskId);
    if (parent.task.projectId !== project.id) throw new AppError("VALIDATION_FAILED", "Parent task must be in the same project.", [{ code: "PARENT_PROJECT", field: "parentTaskId" }]);
    if (parent.task.depth >= 1) throw new AppError("VALIDATION_FAILED", "Subtasks can be nested only two levels deep.", [{ code: "MAX_DEPTH", field: "parentTaskId" }]);
    depth = 1;
  }
  if (data.milestoneId) {
    const [m] = await db.select({ id: milestones.id }).from(milestones).where(and(eq(milestones.organizationId, ctx.organizationId), eq(milestones.projectId, project.id), eq(milestones.id, data.milestoneId)));
    if (!m) throw new AppError("VALIDATION_FAILED", "Unknown milestone.", [{ code: "UNKNOWN_MILESTONE", field: "milestoneId" }]);
  }
  const newId = randomUUID();
  return db.transaction(async (tx) => {
    if (opts.idempotencyKey) {
      const inserted = await tx
        .insert(idempotencyKeys)
        .values({ organizationId: ctx.organizationId, scope: "task.create", key: opts.idempotencyKey, resourceId: newId })
        .onConflictDoNothing()
        .returning({ id: idempotencyKeys.id });
      if (!inserted.length) {
        const [prior] = await tx
          .select({ resourceId: idempotencyKeys.resourceId })
          .from(idempotencyKeys)
          .where(and(eq(idempotencyKeys.organizationId, ctx.organizationId), eq(idempotencyKeys.scope, "task.create"), eq(idempotencyKeys.key, opts.idempotencyKey)));
        const [existing] = await tx.select().from(tasks).where(and(eq(tasks.organizationId, ctx.organizationId), eq(tasks.id, prior!.resourceId)));
        if (!existing) throw new AppError("CONFLICT", "Idempotency key was already used.");
        return { task: existing, replayed: true };
      }
    }
    const [seq] = await tx
      .update(projects)
      .set({ taskSeq: sql`${projects.taskSeq} + 1` })
      .where(and(eq(projects.id, project.id), eq(projects.organizationId, ctx.organizationId)))
      .returning({ n: projects.taskSeq });
    const status = data.status ?? "TODO";
    const [t] = await tx
      .insert(tasks)
      .values({
        id: newId,
        organizationId: ctx.organizationId,
        projectId: project.id,
        number: seq!.n,
        title: data.title,
        description: data.description ?? null,
        status,
        priority: data.priority ?? "MEDIUM",
        ownerUserId: data.ownerUserId ?? null,
        dueDate: data.dueDate ?? null,
        dueTimezone: data.dueTimezone ?? "America/New_York",
        labels: data.labels ?? [],
        parentTaskId: data.parentTaskId ?? null,
        milestoneId: data.milestoneId ?? null,
        depth,
        position: await endOfColumnPosition(tx, project.id, status),
        completedAt: status === "DONE" ? new Date() : null,
        createdBy: ctx.userId,
      })
      .returning();
    if (data.collaboratorUserIds?.length) {
      await tx.insert(taskCollaborators).values([...new Set(data.collaboratorUserIds)].map((userId) => ({ organizationId: ctx.organizationId, taskId: newId, userId })));
    }
    await event(tx, ctx, newId, "CREATED", null, status);
    await audit(tx, ctx, { action: "task.create", resourceType: "task", resourceId: newId, metadata: { projectId: project.id } });
    return { task: t!, replayed: false };
  });
}

export async function updateTask(db: Db, ctx: AuthContext, taskId: string, input: unknown) {
  const { task } = await requireTaskEdit(db, ctx, taskId, "task.update");
  const { version, collaboratorUserIds, ...patch } = parse(taskUpdate, input);
  await assertMember(db, ctx, patch.ownerUserId);
  await assertCollaborators(db, ctx, collaboratorUserIds);
  if (patch.milestoneId) {
    const [m] = await db.select({ id: milestones.id }).from(milestones).where(and(eq(milestones.organizationId, ctx.organizationId), eq(milestones.projectId, task.projectId), eq(milestones.id, patch.milestoneId)));
    if (!m) throw new AppError("VALIDATION_FAILED", "Unknown milestone.", [{ code: "UNKNOWN_MILESTONE", field: "milestoneId" }]);
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(tasks)
      .set({ ...patch, version: version + 1 })
      .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, ctx.organizationId), eq(tasks.version, version)))
      .returning();
    if (!row) throw versionConflict();
    if (collaboratorUserIds) {
      await tx.delete(taskCollaborators).where(and(eq(taskCollaborators.organizationId, ctx.organizationId), eq(taskCollaborators.taskId, taskId)));
      if (collaboratorUserIds.length) {
        await tx.insert(taskCollaborators).values([...new Set(collaboratorUserIds)].map((userId) => ({ organizationId: ctx.organizationId, taskId, userId })));
      }
    }
    if (patch.ownerUserId !== undefined && patch.ownerUserId !== task.ownerUserId) await event(tx, ctx, taskId, "OWNER_CHANGED", task.ownerUserId, patch.ownerUserId);
    if (patch.priority && patch.priority !== task.priority) await event(tx, ctx, taskId, "PRIORITY_CHANGED", task.priority, patch.priority);
    if (patch.dueDate !== undefined && patch.dueDate !== task.dueDate) await event(tx, ctx, taskId, "DUE_CHANGED", task.dueDate, patch.dueDate);
    const fields = [...Object.keys(patch), ...(collaboratorUserIds ? ["collaboratorUserIds"] : [])];
    if (fields.some((f) => ["title", "description", "labels", "milestoneId"].includes(f))) await event(tx, ctx, taskId, "EDITED", null, fields.join(","));
    await audit(tx, ctx, { action: "task.update", resourceType: "task", resourceId: taskId, metadata: { fields } });
    return row;
  });
}

/** Status change and/or reorder (board drag-drop or keyboard move). */
export async function moveTask(db: Db, ctx: AuthContext, taskId: string, input: unknown) {
  const { task } = await requireTaskEdit(db, ctx, taskId, "task.move");
  const data = parse(taskMove, input);
  if (data.status === "DONE" && task.status !== "DONE") {
    const blockers = await db.execute<{ id: string; number: number }>(sql`
      select b.id, b.number from task_dependencies d join tasks b on b.id = d.blocking_task_id
      where d.blocked_task_id = ${taskId} and d.kind = 'BLOCKS' and b.deleted_at is null and b.status not in ('DONE','CANCELLED')`);
    if (blockers.length) {
      throw new AppError("TASK_BLOCKED", "This task is blocked by unfinished tasks.", [...blockers].map((b) => ({ code: "BLOCKED_BY", field: String(b.number) })));
    }
  }
  return db.transaction(async (tx) => {
    let position: number;
    if (data.beforeTaskId) {
      const [before] = await tx
        .select({ position: tasks.position, status: tasks.status, projectId: tasks.projectId })
        .from(tasks)
        .where(and(eq(tasks.id, data.beforeTaskId), eq(tasks.organizationId, ctx.organizationId), isNull(tasks.deletedAt)));
      if (!before || before.projectId !== task.projectId || before.status !== data.status) {
        throw new AppError("VALIDATION_FAILED", "Invalid drop target.", [{ code: "BAD_TARGET", field: "beforeTaskId" }]);
      }
      const [prev] = await tx
        .select({ position: tasks.position })
        .from(tasks)
        .where(and(eq(tasks.projectId, task.projectId), eq(tasks.status, data.status), isNull(tasks.deletedAt), lt(tasks.position, before.position), ne(tasks.id, taskId)))
        .orderBy(desc(tasks.position))
        .limit(1);
      position = prev ? (prev.position + before.position) / 2 : before.position - 1024;
    } else if (data.status === task.status) {
      const [r] = await tx
        .select({ max: sql<number | null>`max(${tasks.position})` })
        .from(tasks)
        .where(and(eq(tasks.projectId, task.projectId), eq(tasks.status, data.status), isNull(tasks.deletedAt), ne(tasks.id, taskId)));
      position = (r?.max ?? 0) + 1024;
    } else {
      position = await endOfColumnPosition(tx, task.projectId, data.status);
    }
    const [row] = await tx
      .update(tasks)
      .set({
        status: data.status,
        position,
        version: data.version + 1,
        completedAt: data.status === "DONE" ? (task.completedAt ?? new Date()) : null,
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, ctx.organizationId), eq(tasks.version, data.version)))
      .returning();
    if (!row) throw versionConflict();
    if (task.status !== data.status) {
      await event(tx, ctx, taskId, "STATUS_CHANGED", task.status, data.status);
      await audit(tx, ctx, { action: "task.status", resourceType: "task", resourceId: taskId, metadata: { from: task.status, to: data.status } });
    }
    return row;
  });
}

export async function deleteTask(db: Db, ctx: AuthContext, taskId: string) {
  await requireTaskEdit(db, ctx, taskId, "task.delete");
  return db.transaction(async (tx) => {
    await tx.update(tasks).set({ deletedAt: new Date() }).where(and(eq(tasks.organizationId, ctx.organizationId), or(eq(tasks.id, taskId), eq(tasks.parentTaskId, taskId))));
    await event(tx, ctx, taskId, "DELETED");
    await audit(tx, ctx, { action: "task.delete", resourceType: "task", resourceId: taskId });
  });
}

export async function getTaskDetail(db: Db, ctx: AuthContext, taskId: string) {
  const { task, project } = await loadTaskWithProject(db, ctx, taskId);
  const [collabs, checklist, comments, events, blockedBy, blocking, subtasks] = await Promise.all([
    db
      .select({ userId: taskCollaborators.userId, displayName: memberships.displayName })
      .from(taskCollaborators)
      .innerJoin(memberships, and(eq(memberships.userId, taskCollaborators.userId), eq(memberships.organizationId, taskCollaborators.organizationId)))
      .where(and(eq(taskCollaborators.organizationId, ctx.organizationId), eq(taskCollaborators.taskId, taskId))),
    db.select().from(checklistItems).where(and(eq(checklistItems.organizationId, ctx.organizationId), eq(checklistItems.taskId, taskId))).orderBy(asc(checklistItems.position), asc(checklistItems.createdAt)),
    db
      .select({ id: taskComments.id, body: taskComments.body, createdAt: taskComments.createdAt, authorName: memberships.displayName, authorUserId: taskComments.authorUserId })
      .from(taskComments)
      .leftJoin(memberships, and(eq(memberships.userId, taskComments.authorUserId), eq(memberships.organizationId, taskComments.organizationId)))
      .where(and(eq(taskComments.organizationId, ctx.organizationId), eq(taskComments.taskId, taskId)))
      .orderBy(asc(taskComments.createdAt)),
    db
      .select({ id: taskEvents.id, type: taskEvents.type, fromValue: taskEvents.fromValue, toValue: taskEvents.toValue, createdAt: taskEvents.createdAt, actorName: memberships.displayName })
      .from(taskEvents)
      .leftJoin(memberships, and(eq(memberships.userId, taskEvents.actorUserId), eq(memberships.organizationId, taskEvents.organizationId)))
      .where(and(eq(taskEvents.organizationId, ctx.organizationId), eq(taskEvents.taskId, taskId)))
      .orderBy(desc(taskEvents.createdAt))
      .limit(50),
    db
      .select({ dependencyId: taskDependencies.id, kind: taskDependencies.kind, id: tasks.id, number: tasks.number, title: tasks.title, status: tasks.status, projectKey: projects.key })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.blockingTaskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(taskDependencies.organizationId, ctx.organizationId), eq(taskDependencies.blockedTaskId, taskId), isNull(tasks.deletedAt))),
    db
      .select({ dependencyId: taskDependencies.id, kind: taskDependencies.kind, id: tasks.id, number: tasks.number, title: tasks.title, status: tasks.status, projectKey: projects.key })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.blockedTaskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(taskDependencies.organizationId, ctx.organizationId), eq(taskDependencies.blockingTaskId, taskId), isNull(tasks.deletedAt))),
    db
      .select({ id: tasks.id, number: tasks.number, title: tasks.title, status: tasks.status })
      .from(tasks)
      .where(and(eq(tasks.organizationId, ctx.organizationId), eq(tasks.parentTaskId, taskId), isNull(tasks.deletedAt)))
      .orderBy(asc(tasks.number)),
  ]);
  const [owner] = task.ownerUserId
    ? await db.select({ displayName: memberships.displayName }).from(memberships).where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.userId, task.ownerUserId)))
    : [];
  return {
    task,
    project: { id: project.id, key: project.key, name: project.name },
    ownerName: owner?.displayName ?? null,
    canEdit: can(ctx, "projects.edit", { siteId: project.siteId, departmentId: project.departmentId }),
    isBlocked: blockedBy.some((b) => b.kind === "BLOCKS" && b.status !== "DONE" && b.status !== "CANCELLED"),
    collaborators: collabs,
    checklist,
    comments,
    events,
    blockedBy,
    blocking,
    subtasks,
  };
}

export type TaskListItem = TaskRow & { isBlocked: boolean; ownerName: string | null; projectKey: string; projectName: string };

const listSelect = { task: tasks, isBlocked: isBlockedSql, ownerName, projectKey: projects.key, projectName: projects.name };
const flatten = (r: { task: TaskRow; isBlocked: boolean; ownerName: string | null; projectKey: string; projectName: string }): TaskListItem => ({
  ...r.task,
  isBlocked: r.isBlocked,
  ownerName: r.ownerName,
  projectKey: r.projectKey,
  projectName: r.projectName,
});

export async function listTasks(db: Db, ctx: AuthContext, query: unknown) {
  await authorize(db, ctx, "projects.read", "ANY");
  const q = parse(taskListQuery, query);
  const where: SQL[] = [eq(tasks.organizationId, ctx.organizationId), isNull(tasks.deletedAt), projectScopeWhere(ctx)];
  if (q.projectId) where.push(eq(tasks.projectId, q.projectId));
  if (q.status) where.push(eq(tasks.status, q.status));
  if (q.priority) where.push(eq(tasks.priority, q.priority));
  if (q.ownerUserId) where.push(eq(tasks.ownerUserId, q.ownerUserId));
  if (q.label) where.push(sql`${q.label} = any(${tasks.labels})`);
  if (q.q) where.push(ilike(tasks.title, `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
  if (q.dueFrom) where.push(gte(tasks.dueDate, q.dueFrom));
  if (q.dueTo) where.push(lte(tasks.dueDate, q.dueTo));
  const base = db.select(listSelect).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId));
  const [rows, [total]] = await Promise.all([
    base
      .where(and(...where))
      .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.number))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(and(...where)),
  ]);
  return { items: rows.map(flatten), total: Number(total?.n ?? 0), page: q.page, pageSize: q.pageSize };
}

export async function getBoard(db: Db, ctx: AuthContext, projectId: string) {
  const project = await getProject(db, ctx, projectId);
  const rows = await db
    .select(listSelect)
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.organizationId, ctx.organizationId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt), ne(tasks.status, "CANCELLED")))
    .orderBy(asc(tasks.position), asc(tasks.number));
  return { project, canEdit: can(ctx, "projects.edit", { siteId: project.siteId, departmentId: project.departmentId }), tasks: rows.map(flatten) };
}

export async function getCalendar(db: Db, ctx: AuthContext, projectId: string, from: string, to: string) {
  await getProject(db, ctx, projectId);
  const rows = await db
    .select(listSelect)
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.organizationId, ctx.organizationId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt), gte(tasks.dueDate, from), lte(tasks.dueDate, to)))
    .orderBy(asc(tasks.dueDate), asc(tasks.number));
  return rows.map(flatten);
}

/** Tasks owned by or shared with the caller, grouped relative to "today" in the org time zone. */
export async function getMyWork(db: Db, ctx: AuthContext, timeZone = "America/New_York") {
  await authorize(db, ctx, "projects.read", "ANY");
  const mine = or(
    eq(tasks.ownerUserId, ctx.userId),
    sql`exists (select 1 from task_collaborators c where c.task_id = ${tasks.id} and c.user_id = ${ctx.userId})`,
  )!;
  const rows = await db
    .select(listSelect)
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.organizationId, ctx.organizationId), isNull(tasks.deletedAt), notInArray(tasks.status, ["DONE", "CANCELLED"]), projectScopeWhere(ctx), mine))
    .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.number))
    .limit(500);
  const today = todayIn(timeZone);
  const items = rows.map(flatten);
  return {
    today,
    overdue: items.filter((t) => t.dueDate && t.dueDate < today),
    dueToday: items.filter((t) => t.dueDate === today),
    upcoming: items.filter((t) => t.dueDate && t.dueDate > today),
    noDate: items.filter((t) => !t.dueDate),
  };
}

// ---------- Comments & checklist ----------
export async function addComment(db: Db, ctx: AuthContext, taskId: string, input: unknown) {
  await requireTaskEdit(db, ctx, taskId, "task.comment");
  const data = parse(commentCreate, input);
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(taskComments).values({ organizationId: ctx.organizationId, taskId, authorUserId: ctx.userId, body: data.body }).returning();
    await event(tx, ctx, taskId, "COMMENTED");
    await audit(tx, ctx, { action: "task.comment", resourceType: "task", resourceId: taskId, metadata: { commentId: c!.id } });
    return c!;
  });
}

export async function addChecklistItem(db: Db, ctx: AuthContext, taskId: string, input: unknown) {
  await requireTaskEdit(db, ctx, taskId, "task.checklist");
  const data = parse(checklistCreate, input);
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select({ max: sql<number | null>`max(${checklistItems.position})` })
      .from(checklistItems)
      .where(eq(checklistItems.taskId, taskId));
    const [item] = await tx.insert(checklistItems).values({ organizationId: ctx.organizationId, taskId, text: data.text, position: (r?.max ?? 0) + 1 }).returning();
    await event(tx, ctx, taskId, "CHECKLIST_ADDED", null, item!.id);
    return item!;
  });
}

export async function updateChecklistItem(db: Db, ctx: AuthContext, taskId: string, itemId: string, input: unknown) {
  await requireTaskEdit(db, ctx, taskId, "task.checklist");
  const data = parse(checklistUpdate, input);
  return db.transaction(async (tx) => {
    const [item] = await tx
      .update(checklistItems)
      .set(data)
      .where(and(eq(checklistItems.organizationId, ctx.organizationId), eq(checklistItems.taskId, taskId), eq(checklistItems.id, itemId)))
      .returning();
    if (!item) throw notFound("Checklist item");
    if (data.done !== undefined) await event(tx, ctx, taskId, data.done ? "CHECKLIST_DONE" : "CHECKLIST_REOPENED", null, item.id);
    return item;
  });
}

export async function deleteChecklistItem(db: Db, ctx: AuthContext, taskId: string, itemId: string) {
  await requireTaskEdit(db, ctx, taskId, "task.checklist");
  await db.delete(checklistItems).where(and(eq(checklistItems.organizationId, ctx.organizationId), eq(checklistItems.taskId, taskId), eq(checklistItems.id, itemId)));
}

// ---------- Dependencies ----------
/** `taskId` becomes blocked by `blockingTaskId`. Rejects self-links, cross-org links and BLOCKS cycles. */
export async function addDependency(db: Db, ctx: AuthContext, taskId: string, input: unknown) {
  const { task } = await requireTaskEdit(db, ctx, taskId, "task.dependency.add");
  const data = parse(dependencyCreate, input);
  if (data.blockingTaskId === taskId) throw new AppError("DEPENDENCY_CYCLE", "A task cannot depend on itself.");
  // Must be visible to the caller and in the same organization (loadTaskWithProject enforces both).
  await loadTaskWithProject(db, ctx, data.blockingTaskId);
  return db.transaction(async (tx) => {
    // Serialize dependency-graph mutations per organization so two concurrent inserts can't form a cycle.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"task_deps:" + ctx.organizationId}))`);
    if (data.kind === "BLOCKS") {
      const cycle = await tx.execute(sql`
        with recursive reach(id) as (
          select d.blocked_task_id from task_dependencies d
            where d.organization_id = ${ctx.organizationId} and d.kind = 'BLOCKS' and d.blocking_task_id = ${taskId}
          union
          select d.blocked_task_id from task_dependencies d join reach r on d.blocking_task_id = r.id
            where d.organization_id = ${ctx.organizationId} and d.kind = 'BLOCKS'
        ) select 1 from reach where id = ${data.blockingTaskId} limit 1`);
      if (cycle.length) throw new AppError("DEPENDENCY_CYCLE", "This dependency would create a cycle.", [{ code: "CYCLE", field: "blockingTaskId" }]);
    }
    const [dep] = await tx
      .insert(taskDependencies)
      .values({ organizationId: ctx.organizationId, blockingTaskId: data.blockingTaskId, blockedTaskId: taskId, kind: data.kind, createdBy: ctx.userId })
      .onConflictDoNothing()
      .returning();
    if (dep) {
      await event(tx, ctx, taskId, "DEPENDENCY_ADDED", data.kind, data.blockingTaskId);
      await audit(tx, ctx, { action: "task.dependency.add", resourceType: "task", resourceId: taskId, metadata: { blockingTaskId: data.blockingTaskId, kind: data.kind, projectId: task.projectId } });
    }
    return dep ?? null;
  });
}

export async function removeDependency(db: Db, ctx: AuthContext, taskId: string, dependencyId: string) {
  await requireTaskEdit(db, ctx, taskId, "task.dependency.remove");
  return db.transaction(async (tx) => {
    const del = await tx
      .delete(taskDependencies)
      .where(
        and(
          eq(taskDependencies.organizationId, ctx.organizationId),
          eq(taskDependencies.id, dependencyId),
          or(eq(taskDependencies.blockedTaskId, taskId), eq(taskDependencies.blockingTaskId, taskId)),
        ),
      )
      .returning();
    if (!del.length) throw notFound("Dependency");
    await event(tx, ctx, taskId, "DEPENDENCY_REMOVED", null, dependencyId);
    await audit(tx, ctx, { action: "task.dependency.remove", resourceType: "task", resourceId: taskId, metadata: { dependencyId } });
  });
}

/** Search tasks for dependency pickers (visible tasks only). */
export async function searchTasks(db: Db, ctx: AuthContext, text: string, excludeId?: string) {
  const where: SQL[] = [eq(tasks.organizationId, ctx.organizationId), isNull(tasks.deletedAt), projectScopeWhere(ctx)];
  if (excludeId) where.push(ne(tasks.id, excludeId));
  const n = Number(text.replace(/^.*-/, ""));
  if (text.trim()) {
    where.push(or(ilike(tasks.title, `%${text.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`), Number.isInteger(n) && n > 0 ? eq(tasks.number, n) : sql`false`)!);
  }
  const rows = await db
    .select({ id: tasks.id, number: tasks.number, title: tasks.title, status: tasks.status, projectKey: projects.key })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(...where))
    .orderBy(desc(tasks.updatedAt))
    .limit(10);
  return rows;
}

export const STATUS_ORDER: TaskStatus[] = ["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "DONE"];
