import { and, eq, isNotNull, isNull, lte, notInArray } from "drizzle-orm";
import type { Db } from "@projectos/db";
import { organizations, projects, tasks } from "@projectos/db/schema";
import { addDays, todayIn } from "@projectos/shared";
import { enqueueNotification } from "./outbox";

export const TASK_DUE_SOON_DAYS = 1;

/**
 * Due-soon / overdue reminders for project tasks with an owner. Idempotent: the dedupe key includes the due
 * date, so re-running (every worker tick, retries) never duplicates, while moving the due date re-arms it.
 */
export async function scanTaskDue(db: Db, opts: { organizationId?: string; now?: Date } = {}) {
  const orgs = await db
    .select({ id: organizations.id, timezone: organizations.timezone })
    .from(organizations)
    .where(opts.organizationId ? eq(organizations.id, opts.organizationId) : eq(organizations.status, "ACTIVE"));
  let queued = 0;
  for (const o of orgs) {
    const today = todayIn(o.timezone, opts.now);
    const rows = await db
      .select({ id: tasks.id, number: tasks.number, title: tasks.title, dueDate: tasks.dueDate, ownerUserId: tasks.ownerUserId, projectId: tasks.projectId, key: projects.key })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          eq(tasks.organizationId, o.id),
          isNull(tasks.deletedAt),
          isNull(projects.deletedAt),
          isNotNull(tasks.ownerUserId),
          notInArray(tasks.status, ["DONE", "CANCELLED"]),
          lte(tasks.dueDate, addDays(today, TASK_DUE_SOON_DAYS)),
        ),
      );
    for (const t of rows) {
      const overdue = t.dueDate! < today;
      const id = await enqueueNotification(db, {
        organizationId: o.id,
        userId: t.ownerUserId!,
        kind: overdue ? "TASK_OVERDUE" : "TASK_DUE_SOON",
        title: `${t.key}-${t.number} ${overdue ? "is overdue" : "is due soon"}`,
        body: `${t.title} — due ${t.dueDate}`,
        link: `/projects/${t.projectId}/list?task=${t.id}`,
        resourceType: "task",
        resourceId: t.id,
        dedupeKey: `${overdue ? "task.overdue" : "task.due_soon"}:${t.id}:${t.dueDate}`,
      });
      if (id) queued++;
    }
  }
  return { queued };
}
