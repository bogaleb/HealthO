import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@projectos/db";
import { memberships, milestones, projectTemplates, projects, tasks } from "@projectos/db/schema";
import { can, type AuthContext } from "@projectos/auth";
import { AppError, addDays, milestoneCreate, notFound, projectCreate, projectUpdate, todayIn, versionConflict, type TaskPriority } from "@projectos/shared";
import { audit } from "../audit";
import { authorize } from "../authz";
import { assertOrgScopeRefs } from "../org/sites";
import { mapDbError, parse } from "../util";
import { projectScopeWhere } from "./scope";

export type ProjectRow = typeof projects.$inferSelect;

export async function assertMember(db: Db, ctx: AuthContext, userId: string | null | undefined, field = "ownerUserId") {
  if (!userId) return;
  const [m] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.userId, userId), eq(memberships.status, "ACTIVE")));
  if (!m) throw new AppError("VALIDATION_FAILED", "Assignee must be an active member of this organization.", [{ code: "NOT_A_MEMBER", field }]);
}

export async function listProjects(db: Db, ctx: AuthContext, opts: { status?: string } = {}) {
  await authorize(db, ctx, "projects.read", "ANY");
  const where = [projectScopeWhere(ctx)];
  if (opts.status) where.push(eq(projects.status, opts.status));
  const rows = await db
    .select({
      project: projects,
      ownerName: memberships.displayName,
      openTasks: sql<number>`(select count(*)::int from ${tasks} t where t.project_id = ${projects.id} and t.deleted_at is null and t.status not in ('DONE','CANCELLED'))`,
      doneTasks: sql<number>`(select count(*)::int from ${tasks} t where t.project_id = ${projects.id} and t.deleted_at is null and t.status = 'DONE')`,
      overdueTasks: sql<number>`(select count(*)::int from ${tasks} t where t.project_id = ${projects.id} and t.deleted_at is null and t.status not in ('DONE','CANCELLED') and t.due_date < (now() at time zone t.due_timezone)::date)`,
    })
    .from(projects)
    .leftJoin(memberships, and(eq(memberships.userId, projects.ownerUserId), eq(memberships.organizationId, projects.organizationId)))
    .where(and(...where))
    .orderBy(asc(projects.name));
  return rows.map((r) => ({ ...r.project, ownerName: r.ownerName, openTasks: r.openTasks, doneTasks: r.doneTasks, overdueTasks: r.overdueTasks }));
}

/** Loads a project the caller may read; 404 (not 403) when out of scope to avoid enumeration. */
export async function getProject(db: Db, ctx: AuthContext, id: string) {
  const [row] = await db.select().from(projects).where(and(projectScopeWhere(ctx), eq(projects.id, id)));
  if (!row) throw notFound("Project");
  return row;
}

export async function getProjectDetail(db: Db, ctx: AuthContext, id: string) {
  const project = await getProject(db, ctx, id);
  const ms = await db
    .select({
      milestone: milestones,
      total: sql<number>`(select count(*)::int from ${tasks} t where t.milestone_id = ${milestones.id} and t.deleted_at is null)`,
      done: sql<number>`(select count(*)::int from ${tasks} t where t.milestone_id = ${milestones.id} and t.deleted_at is null and t.status = 'DONE')`,
    })
    .from(milestones)
    .where(and(eq(milestones.organizationId, ctx.organizationId), eq(milestones.projectId, id)))
    .orderBy(asc(milestones.dueDate));
  const statusCounts = await db
    .select({ status: tasks.status, n: count() })
    .from(tasks)
    .where(and(eq(tasks.organizationId, ctx.organizationId), eq(tasks.projectId, id), isNull(tasks.deletedAt)))
    .groupBy(tasks.status);
  const blocked = await db.execute<{ id: string; number: number; title: string }>(sql`
    select t.id, t.number, t.title from tasks t
    where t.project_id = ${id} and t.organization_id = ${ctx.organizationId} and t.deleted_at is null and t.status not in ('DONE','CANCELLED')
      and (t.status = 'BLOCKED' or exists (select 1 from task_dependencies d join tasks b on b.id = d.blocking_task_id
        where d.blocked_task_id = t.id and d.kind = 'BLOCKS' and b.status not in ('DONE','CANCELLED') and b.deleted_at is null))
    order by t.number limit 50`);
  return {
    project,
    canEdit: can(ctx, "projects.edit", { siteId: project.siteId, departmentId: project.departmentId }),
    milestones: ms.map((m) => ({ ...m.milestone, total: m.total, done: m.done })),
    statusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, Number(s.n)])) as Record<string, number>,
    blockedTasks: [...blocked],
  };
}

interface TemplateTask {
  title: string;
  priority?: TaskPriority;
  offsetDays?: number;
  labels?: string[];
  milestone?: string;
}

export async function createProject(db: Db, ctx: AuthContext, input: unknown) {
  const data = parse(projectCreate, input);
  await authorize(db, ctx, "projects.edit", { siteId: data.siteId, departmentId: data.departmentId }, { action: "project.create", resourceType: "project" });
  await assertOrgScopeRefs(db, ctx, data);
  await assertMember(db, ctx, data.ownerUserId);
  let template: typeof projectTemplates.$inferSelect | undefined;
  if (data.templateId) {
    [template] = await db.select().from(projectTemplates).where(and(eq(projectTemplates.organizationId, ctx.organizationId), eq(projectTemplates.id, data.templateId)));
    if (!template) throw new AppError("VALIDATION_FAILED", "Unknown template.", [{ code: "UNKNOWN_TEMPLATE", field: "templateId" }]);
  }
  if (data.startDate && data.dueDate && data.dueDate < data.startDate) {
    throw new AppError("VALIDATION_FAILED", "Due date must be on or after start date.", [{ code: "DATE_ORDER", field: "dueDate" }]);
  }
  try {
    return await db.transaction(async (tx) => {
      const { templateId: _t, ...values } = data;
      const [p] = await tx
        .insert(projects)
        .values({ ...values, organizationId: ctx.organizationId, ownerUserId: data.ownerUserId ?? ctx.userId, createdBy: ctx.userId })
        .returning();
      if (template) {
        const start = data.startDate ?? todayIn("America/New_York");
        const msDefs = (template.milestones as { name: string; offsetDays?: number }[]) ?? [];
        const msIds = new Map<string, string>();
        for (const m of msDefs) {
          const [row] = await tx
            .insert(milestones)
            .values({ organizationId: ctx.organizationId, projectId: p!.id, name: m.name, dueDate: m.offsetDays != null ? addDays(start, m.offsetDays) : null })
            .returning({ id: milestones.id });
          msIds.set(m.name, row!.id);
        }
        const tdefs = (template.tasks as TemplateTask[]) ?? [];
        let n = 0;
        for (const t of tdefs) {
          n += 1;
          await tx.insert(tasks).values({
            organizationId: ctx.organizationId,
            projectId: p!.id,
            number: n,
            title: t.title,
            priority: t.priority ?? "MEDIUM",
            labels: t.labels ?? [],
            dueDate: t.offsetDays != null ? addDays(start, t.offsetDays) : null,
            milestoneId: t.milestone ? (msIds.get(t.milestone) ?? null) : null,
            position: n * 1024,
            createdBy: ctx.userId,
          });
        }
        await tx.update(projects).set({ taskSeq: n }).where(eq(projects.id, p!.id));
      }
      await audit(tx, ctx, { action: "project.create", resourceType: "project", resourceId: p!.id, metadata: { templateId: data.templateId ?? null } });
      return p!;
    });
  } catch (e) {
    mapDbError(e, "A project with this key already exists.");
  }
}

export async function updateProject(db: Db, ctx: AuthContext, id: string, input: unknown) {
  const existing = await getProject(db, ctx, id);
  await authorize(db, ctx, "projects.edit", { siteId: existing.siteId, departmentId: existing.departmentId }, { action: "project.update", resourceType: "project", resourceId: id });
  const { version, ...patch } = parse(projectUpdate, input);
  await assertMember(db, ctx, patch.ownerUserId);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(projects)
        .set({ ...patch, version: version + 1 })
        .where(and(eq(projects.id, id), eq(projects.organizationId, ctx.organizationId), eq(projects.version, version)))
        .returning();
      if (!row) throw versionConflict();
      await audit(tx, ctx, { action: "project.update", resourceType: "project", resourceId: id, metadata: { fields: Object.keys(patch) } });
      return row;
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    mapDbError(e);
  }
}

export async function createMilestone(db: Db, ctx: AuthContext, projectId: string, input: unknown) {
  const p = await getProject(db, ctx, projectId);
  await authorize(db, ctx, "projects.edit", { siteId: p.siteId, departmentId: p.departmentId });
  const data = parse(milestoneCreate, input);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(milestones).values({ ...data, organizationId: ctx.organizationId, projectId }).returning();
    await audit(tx, ctx, { action: "milestone.create", resourceType: "milestone", resourceId: row!.id, metadata: { projectId } });
    return row!;
  });
}

export async function listTemplates(db: Db, ctx: AuthContext) {
  return db
    .select({ id: projectTemplates.id, name: projectTemplates.name, description: projectTemplates.description, departmentId: projectTemplates.departmentId, tasks: projectTemplates.tasks })
    .from(projectTemplates)
    .where(eq(projectTemplates.organizationId, ctx.organizationId))
    .orderBy(asc(projectTemplates.name));
}

export async function recentProjects(db: Db, ctx: AuthContext, limit = 5) {
  return db.select().from(projects).where(projectScopeWhere(ctx)).orderBy(desc(projects.updatedAt)).limit(limit);
}

