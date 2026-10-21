import { and, count, eq, isNull, notInArray, sql } from "drizzle-orm";
import { qualified, type Db } from "@projectos/db";
import { memberships, organizations, sites, tasks } from "@projectos/db/schema";
import { hasAny, type AuthContext } from "@projectos/auth";
import { todayIn } from "@projectos/shared";
import { projects } from "@projectos/db/schema";
import { projectScopeWhere } from "./projects/scope";

/** SQL-derived home metrics. Every number carries its definition and the time it was computed. */
export async function getHomeSummary(db: Db, ctx: AuthContext) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, ctx.organizationId));
  const tz = org?.timezone ?? "America/New_York";
  const today = todayIn(tz);
  const [siteCount] = await db.select({ n: count() }).from(sites).where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.active, true)));
  const [memberCount] = await db.select({ n: count() }).from(memberships).where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.status, "ACTIVE")));
  let projectMetrics = null as null | { activeProjects: number; openTasks: number; overdueTasks: number; myOpen: number; myOverdue: number };
  if (hasAny(ctx, "projects.read")) {
    const scope = projectScopeWhere(ctx);
    const open = and(eq(tasks.organizationId, ctx.organizationId), isNull(tasks.deletedAt), notInArray(tasks.status, ["DONE", "CANCELLED"]), scope);
    const overdue = sql`${tasks.dueDate} < ${today}`;
    // Same definition as the /tasks?mine=true drill-down: owner OR collaborator.
    const mine = sql`(${qualified(tasks.ownerUserId)} = ${ctx.userId} or exists (select 1 from task_collaborators c where c.task_id = ${qualified(tasks.id)} and c.user_id = ${ctx.userId}))`;
    const q = (extra?: ReturnType<typeof sql>) =>
      db.select({ n: count() }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(extra ? and(open, extra) : open);
    const [[ap], [ot], [od], [mo], [mod]] = await Promise.all([
      db.select({ n: count() }).from(projects).where(and(scope, eq(projects.status, "ACTIVE"))),
      q(),
      q(overdue),
      q(sql`${mine}`),
      q(sql`${mine} and ${overdue}`),
    ]);
    projectMetrics = { activeProjects: Number(ap?.n ?? 0), openTasks: Number(ot?.n ?? 0), overdueTasks: Number(od?.n ?? 0), myOpen: Number(mo?.n ?? 0), myOverdue: Number(mod?.n ?? 0) };
  }
  return {
    organization: org ? { name: org.name, timezone: tz, isSynthetic: org.isSynthetic } : null,
    today,
    computedAt: new Date().toISOString(),
    activeSites: Number(siteCount?.n ?? 0),
    activeMembers: Number(memberCount?.n ?? 0),
    projectMetrics,
  };
}
