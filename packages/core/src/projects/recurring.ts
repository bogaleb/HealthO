import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@projectos/db";
import { projects, recurringTaskDefinitions, tasks } from "@projectos/db/schema";
import type { AuthContext } from "@projectos/auth";
import { addDays, recurringCreate, todayIn, weekdayOf } from "@projectos/shared";
import { audit } from "../audit";
import { authorize } from "../authz";
import { parse } from "../util";
import { assertMember, getProject } from "./projects";

type Def = typeof recurringTaskDefinitions.$inferSelect;

/** Pure: occurrence dates for a definition in (after, through], capped. */
export function occurrencesBetween(def: Pick<Def, "cadence" | "weekday" | "monthDay" | "startOn">, after: string | null, through: string, cap = 62): string[] {
  const out: string[] = [];
  let d = after && after >= def.startOn ? addDays(after, 1) : def.startOn;
  while (d <= through && out.length < cap) {
    const matches = def.cadence === "DAILY" || (def.cadence === "WEEKLY" && weekdayOf(d) === def.weekday) || (def.cadence === "MONTHLY" && Number(d.slice(8, 10)) === def.monthDay);
    if (matches) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export async function createRecurringDefinition(db: Db, ctx: AuthContext, input: unknown) {
  const data = parse(recurringCreate, input);
  const p = await getProject(db, ctx, data.projectId);
  await authorize(db, ctx, "projects.edit", { siteId: p.siteId, departmentId: p.departmentId }, { action: "recurring.create", resourceType: "recurring_task_definition" });
  await assertMember(db, ctx, data.ownerUserId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(recurringTaskDefinitions)
      .values({
        ...data,
        weekday: data.cadence === "WEEKLY" ? (data.weekday ?? weekdayOf(data.startOn)) : null,
        monthDay: data.cadence === "MONTHLY" ? (data.monthDay ?? Math.min(28, Number(data.startOn.slice(8, 10)))) : null,
        organizationId: ctx.organizationId,
        createdBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, { action: "recurring.create", resourceType: "recurring_task_definition", resourceId: row!.id, metadata: { projectId: p.id, cadence: data.cadence } });
    return row!;
  });
}

export async function listRecurringDefinitions(db: Db, ctx: AuthContext, projectId: string) {
  await getProject(db, ctx, projectId);
  return db
    .select()
    .from(recurringTaskDefinitions)
    .where(and(eq(recurringTaskDefinitions.organizationId, ctx.organizationId), eq(recurringTaskDefinitions.projectId, projectId)))
    .orderBy(asc(recurringTaskDefinitions.title));
}

/**
 * Idempotent generator (run by the worker; callable manually in tests). Each definition row is
 * locked while generating; the unique (organization, definition, occurrence_date) index is the backstop,
 * so re-running for the same day never creates duplicates.
 */
export async function generateRecurringTasks(db: Db, opts: { organizationId?: string; now?: Date } = {}) {
  const defs = await db
    .select({ id: recurringTaskDefinitions.id, organizationId: recurringTaskDefinitions.organizationId })
    .from(recurringTaskDefinitions)
    .where(and(eq(recurringTaskDefinitions.active, true), opts.organizationId ? eq(recurringTaskDefinitions.organizationId, opts.organizationId) : sql`true`));
  let created = 0;
  for (const { id } of defs) {
    created += await db.transaction(async (tx) => {
      const [def] = await tx.select().from(recurringTaskDefinitions).where(eq(recurringTaskDefinitions.id, id)).for("update");
      if (!def || !def.active) return 0;
      const today = todayIn(def.timezone, opts.now);
      const dates = occurrencesBetween(def, def.lastGeneratedOn, today);
      let n = 0;
      for (const occ of dates) {
        const exists = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.organizationId, def.organizationId), eq(tasks.recurringDefinitionId, def.id), eq(tasks.occurrenceDate, occ)));
        if (exists.length) continue;
        const [seq] = await tx
          .update(projects)
          .set({ taskSeq: sql`${projects.taskSeq} + 1` })
          .where(eq(projects.id, def.projectId))
          .returning({ n: projects.taskSeq });
        const ins = await tx
          .insert(tasks)
          .values({
            organizationId: def.organizationId,
            projectId: def.projectId,
            number: seq!.n,
            title: `${def.title} (${occ})`,
            description: def.description,
            priority: def.priority,
            ownerUserId: def.ownerUserId,
            dueDate: addDays(occ, def.dueInDays),
            dueTimezone: def.timezone,
            labels: ["recurring"],
            position: Date.now() / 1000,
            recurringDefinitionId: def.id,
            occurrenceDate: occ,
          })
          .onConflictDoNothing()
          .returning({ id: tasks.id });
        n += ins.length;
      }
      if (dates.length)
        await tx
          .update(recurringTaskDefinitions)
          .set({ lastGeneratedOn: dates[dates.length - 1] })
          .where(eq(recurringTaskDefinitions.id, def.id));
      if (n)
        await audit(
          tx,
          { system: "recurring.generate", organizationId: def.organizationId },
          { action: "recurring.generate", resourceType: "recurring_task_definition", resourceId: def.id, metadata: { created: n } },
        );
      return n;
    });
  }
  return { definitions: defs.length, created };
}
