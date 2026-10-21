import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@projectos/db";
import { credentialingCases, memberships, practitioners, professionalAuthorities, providerEnrollments, tasks } from "@projectos/db/schema";
import type { AuthContext } from "@projectos/auth";
import { assertMember, audit, authorize, createTask, getProject, moveTask, parse } from "@projectos/core";
import { AppError, CASE_STATUSES, CASE_TYPES, caseCreate, caseLinkTask, caseUpdate, notFound, versionConflict } from "@projectos/shared";
import { canOnPractitioner, loadPractitioner, practitionerScopeWhere } from "./access";

const listQuery = z.object({
  status: z.enum(CASE_STATUSES).optional(),
  caseType: z.enum(CASE_TYPES).optional(),
  ownerUserId: z.uuid().optional(),
  practitionerId: z.uuid().optional(),
  open: z.enum(["true", "false"]).optional(),
});

export async function listCases(db: Db, ctx: AuthContext, query: unknown) {
  await authorize(db, ctx, "credentialing.read", "ANY");
  const q = parse(listQuery, query);
  const where: SQL[] = [eq(credentialingCases.organizationId, ctx.organizationId), practitionerScopeWhere(ctx)];
  if (q.status) where.push(eq(credentialingCases.status, q.status));
  if (q.caseType) where.push(eq(credentialingCases.caseType, q.caseType));
  if (q.ownerUserId) where.push(eq(credentialingCases.ownerUserId, q.ownerUserId));
  if (q.practitionerId) where.push(eq(credentialingCases.practitionerId, q.practitionerId));
  if (q.open === "true") where.push(sql`${credentialingCases.status} not in ('COMPLETED','CANCELLED')`);
  const rows = await db
    .select({
      c: credentialingCases,
      practitionerName: practitioners.displayName,
      ownerName: memberships.displayName,
      taskStatus: tasks.status,
      taskNumber: tasks.number,
      taskProjectId: tasks.projectId,
    })
    .from(credentialingCases)
    .innerJoin(practitioners, eq(practitioners.id, credentialingCases.practitionerId))
    .leftJoin(memberships, and(eq(memberships.userId, credentialingCases.ownerUserId), eq(memberships.organizationId, credentialingCases.organizationId)))
    .leftJoin(tasks, eq(tasks.id, credentialingCases.taskId))
    .where(and(...where))
    .orderBy(sql`${credentialingCases.dueDate} asc nulls last`, asc(credentialingCases.createdAt));
  return rows.map(({ c, ...rest }) => ({ ...c, ...rest }));
}

export async function createCase(db: Db, ctx: AuthContext, input: unknown) {
  const d = parse(caseCreate, input);
  await loadPractitioner(db, ctx, d.practitionerId, { perm: "credentialing.edit", action: "case.create" });
  await assertMember(db, ctx, d.ownerUserId);
  if (d.authorityId) {
    const [a] = await db.select({ p: professionalAuthorities.practitionerId }).from(professionalAuthorities).where(and(eq(professionalAuthorities.organizationId, ctx.organizationId), eq(professionalAuthorities.id, d.authorityId)));
    if (a?.p !== d.practitionerId) throw new AppError("VALIDATION_FAILED", "Authority does not belong to this provider.", [{ code: "BAD_LINK", field: "authorityId" }]);
  }
  if (d.enrollmentId) {
    const [e] = await db.select({ p: providerEnrollments.practitionerId }).from(providerEnrollments).where(and(eq(providerEnrollments.organizationId, ctx.organizationId), eq(providerEnrollments.id, d.enrollmentId)));
    if (e?.p !== d.practitionerId) throw new AppError("VALIDATION_FAILED", "Enrollment does not belong to this provider.", [{ code: "BAD_LINK", field: "enrollmentId" }]);
  }
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(credentialingCases).values({ ...d, organizationId: ctx.organizationId, createdBy: ctx.userId }).returning();
    await audit(tx, ctx, { action: "case.create", resourceType: "credentialing_case", resourceId: c!.id, metadata: { practitionerId: d.practitionerId, caseType: d.caseType } });
    return c!;
  });
}

async function loadCase(db: Db, ctx: AuthContext, id: string) {
  const [c] = await db.select().from(credentialingCases).where(and(eq(credentialingCases.organizationId, ctx.organizationId), eq(credentialingCases.id, id)));
  if (!c) throw notFound("Case");
  const { siteIds } = await loadPractitioner(db, ctx, c.practitionerId);
  if (!canOnPractitioner(ctx, "credentialing.edit", siteIds)) await authorize(db, ctx, "credentialing.edit", {}, { action: "case.update", resourceType: "credentialing_case", resourceId: id });
  return c;
}

/** Completing a case moves its linked project task to Done (kept in sync, no double entry). */
export async function updateCase(db: Db, ctx: AuthContext, id: string, input: unknown) {
  const c = await loadCase(db, ctx, id);
  const { version, ...d } = parse(caseUpdate, input);
  await assertMember(db, ctx, d.ownerUserId);
  const row = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(credentialingCases)
      .set({ ...d, completedAt: d.status === "COMPLETED" ? new Date() : d.status ? null : c.completedAt, version: version + 1 })
      .where(and(eq(credentialingCases.id, id), eq(credentialingCases.version, version)))
      .returning();
    if (!r) throw versionConflict();
    await audit(tx, ctx, { action: "case.update", resourceType: "credentialing_case", resourceId: id, metadata: { fields: Object.keys(d), status: d.status } });
    return r;
  });
  let taskSync: string | null = null;
  if (d.status === "COMPLETED" && c.taskId) {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, c.taskId));
    if (t && t.status !== "DONE" && !t.deletedAt) {
      try {
        await moveTask(db, ctx, t.id, { status: "DONE", version: t.version });
        taskSync = "DONE";
      } catch (e) {
        taskSync = e instanceof AppError ? `NOT_SYNCED: ${e.message}` : "NOT_SYNCED";
      }
    }
  }
  return { ...row, taskSync };
}

/** Creates a project task for this case (uses normal project permissions) and links it. */
export async function linkCaseTask(db: Db, ctx: AuthContext, id: string, input: unknown) {
  const c = await loadCase(db, ctx, id);
  if (c.taskId) throw new AppError("CONFLICT", "This case already has a linked task.");
  const { projectId } = parse(caseLinkTask, input);
  await getProject(db, ctx, projectId);
  const [p] = await db.select({ name: practitioners.displayName }).from(practitioners).where(eq(practitioners.id, c.practitionerId));
  const { task } = await createTask(
    db,
    ctx,
    { projectId, title: `${c.title} — ${p?.name ?? "provider"}`, ownerUserId: c.ownerUserId, dueDate: c.dueDate, labels: ["credentialing"] },
    { idempotencyKey: `case-task-${c.id}` },
  );
  const [row] = await db.update(credentialingCases).set({ taskId: task.id, version: c.version + 1 }).where(and(eq(credentialingCases.id, id), eq(credentialingCases.version, c.version))).returning();
  if (!row) throw versionConflict();
  await audit(db, ctx, { action: "case.link_task", resourceType: "credentialing_case", resourceId: id, metadata: { taskId: task.id, projectId } });
  return { case: row, task };
}
