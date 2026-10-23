import { and, eq, gte, lte, lt, sql } from "drizzle-orm";
import type { Db } from "@projectos/db";
import { authorityVerifications, credentialDeadlineNotices, departments, practitioners, professionalAuthorities, projects, tasks } from "@projectos/db/schema";
import { audit } from "@projectos/core";
import { addDays, ORG_TIMEZONE, todayIn } from "@projectos/shared";

export const DEADLINE_THRESHOLDS = [90, 60, 30] as const;
const RENEWAL_PROJECT_KEY = "RENEW";

async function ensureRenewalProject(db: Db, organizationId: string) {
  const [existing] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.organizationId, organizationId), eq(projects.key, RENEWAL_PROJECT_KEY)));
  if (existing) return existing;
  const [dept] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.organizationId, organizationId), eq(departments.code, "CRED")));
  const [p] = await db
    .insert(projects)
    .values({
      organizationId,
      key: RENEWAL_PROJECT_KEY,
      name: "Credential Renewals (system-generated)",
      description: "Tasks created automatically at 90/60/30 days before a verified authority expires.",
      departmentId: dept?.id ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (p) {
    await audit(db, { system: "credentialing.deadlines", organizationId }, { action: "project.create", resourceType: "project", resourceId: p.id });
    return p;
  }
  const [again] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.organizationId, organizationId), eq(projects.key, RENEWAL_PROJECT_KEY)));
  return again!;
}

/**
 * Idempotent deadline job:
 *  1. Verified authorities past their expiration become EXPIRED (history + audit, system actor).
 *  2. For authorities expiring within 90/60/30 days, create ONE task for the tightest threshold reached;
 *     larger thresholds already passed are recorded as skipped. A unique key per
 *     (authority, threshold, expiry date) guarantees repeated/concurrent runs never duplicate.
 */
export async function runCredentialDeadlines(db: Db, opts: { organizationId?: string; now?: Date } = {}) {
  const today = todayIn(ORG_TIMEZONE, opts.now);
  const orgFilter = opts.organizationId ? eq(professionalAuthorities.organizationId, opts.organizationId) : sql`true`;
  let expired = 0;
  let created = 0;

  const toExpire = await db
    .select()
    .from(professionalAuthorities)
    .where(and(orgFilter, eq(professionalAuthorities.status, "VERIFIED"), lt(professionalAuthorities.expiresOn, today)));
  for (const a of toExpire) {
    await db.transaction(async (tx) => {
      const r = await tx
        .update(professionalAuthorities)
        .set({ status: "EXPIRED", version: a.version + 1 })
        .where(and(eq(professionalAuthorities.id, a.id), eq(professionalAuthorities.status, "VERIFIED")))
        .returning({ id: professionalAuthorities.id });
      if (!r.length) return;
      await tx
        .insert(authorityVerifications)
        .values({ organizationId: a.organizationId, authorityId: a.id, action: "EXPIRE", fromStatus: "VERIFIED", toStatus: "EXPIRED", note: `Expired ${a.expiresOn}` });
      await audit(tx, { system: "credentialing.deadlines", organizationId: a.organizationId }, { action: "authority.expire", resourceType: "authority", resourceId: a.id });
      expired++;
    });
  }

  const upcoming = await db
    .select({ a: professionalAuthorities, name: practitioners.displayName })
    .from(professionalAuthorities)
    .innerJoin(practitioners, eq(practitioners.id, professionalAuthorities.practitionerId))
    .where(
      and(orgFilter, eq(professionalAuthorities.status, "VERIFIED"), gte(professionalAuthorities.expiresOn, today), lte(professionalAuthorities.expiresOn, addDays(today, 90))),
    );
  for (const { a, name } of upcoming) {
    const daysLeft = Math.round((Date.parse(`${a.expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    const reached = DEADLINE_THRESHOLDS.filter((t) => daysLeft <= t); // e.g. 25 days → [90,60,30]
    if (!reached.length) continue;
    const tightest = Math.min(...reached);
    await db.transaction(async (tx) => {
      // Lock the authority row so concurrent runs serialize per authority.
      await tx.execute(sql`select id from professional_authorities where id = ${a.id} for update`);
      const claimed = await tx
        .insert(credentialDeadlineNotices)
        .values(reached.map((t) => ({ organizationId: a.organizationId, authorityId: a.id, thresholdDays: String(t), expiresOn: a.expiresOn! })))
        .onConflictDoNothing()
        .returning();
      const mine = claimed.find((c) => c.thresholdDays === String(tightest));
      if (!mine) return; // already handled by an earlier run
      const project = await ensureRenewalProject(tx as unknown as Db, a.organizationId);
      const [seq] = await tx
        .update(projects)
        .set({ taskSeq: sql`${projects.taskSeq} + 1` })
        .where(eq(projects.id, project.id))
        .returning({ n: projects.taskSeq });
      const [t] = await tx
        .insert(tasks)
        .values({
          organizationId: a.organizationId,
          projectId: project.id,
          number: seq!.n,
          title: `Renew ${a.jurisdiction} ${a.authorityType.replace(/_/g, " ").toLowerCase()} — ${name} (expires ${a.expiresOn}, ${tightest}-day notice)`,
          priority: tightest <= 30 ? "URGENT" : tightest <= 60 ? "HIGH" : "MEDIUM",
          dueDate: addDays(a.expiresOn!, -14),
          labels: ["credentialing", "renewal", `${tightest}-day`],
          position: Date.now() / 1000,
        })
        .returning({ id: tasks.id });
      await tx.update(credentialDeadlineNotices).set({ taskId: t!.id }).where(eq(credentialDeadlineNotices.id, mine.id));
      await audit(
        tx,
        { system: "credentialing.deadlines", organizationId: a.organizationId },
        { action: "authority.deadline_task", resourceType: "authority", resourceId: a.id, metadata: { thresholdDays: tightest, taskId: t!.id } },
      );
      created++;
    });
  }
  return { expired, tasksCreated: created };
}
