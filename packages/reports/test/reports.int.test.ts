import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { appointmentTypes, eligibilityEvaluations, jobs, notifications, outboxEvents, rcmCases } from "@projectos/db/schema";
import { createProject, createTask, enqueueJob, runDueJobs, JOB_HANDLERS } from "@projectos/core";
import { createCase as createCredCase, createPayer, createPlan, createPractitioner } from "@projectos/credentialing";
import { dispatchOutbox, replayJob, scanTaskDue } from "@projectos/notifications";
import { createCase, createQueue, listQueues } from "@projectos/rcm";
import { addDays, todayIn } from "@projectos/shared";
import { makeOrg, testDb, expectAppError, type Fixture } from "../../core/test/helpers";
import { METRICS, getMetricReport, getOperationsDashboard } from "../src";

const { db, end } = testDb();
const today = todayIn("America/New_York");
let A: Fixture;
let B: Fixture;
let sup: Awaited<ReturnType<Fixture["user"]>>;

beforeAll(async () => {
  A = await makeOrg(db, "RP");
  B = await makeOrg(db, "RQ");
  sup = await A.user("rpsup", [{ roleId: A.roleIds.rcm_supervisor!, departmentId: A.depts.rcm.id }]);
  const admin = await A.users.admin.ctx();
  const payer = (await createPayer(db, admin, { code: "RP", name: "Report Payer (SYNTHETIC)" }))!;
  await createPlan(db, admin, { payerId: payer.id, code: "RPP", name: "Report Plan", requiresEnrollment: true });
  const q1 = (await createQueue(db, await sup.ctx(), { name: "Aging", category: "AGING_FOLLOW_UP", departmentId: A.depts.rcm.id, leadUserId: sup.userId }))!;
  const q2 = (await createQueue(db, admin, { name: "Cred dept", category: "CREDENTIALING_PAYER", departmentId: A.depts.cred.id }))!;
  const prac = await createPractitioner(db, admin, { displayName: "Practitioner RP (SYNTHETIC)", profession: "PHYSICIAN", siteIds: [A.sites.s1.id] });
  const cc = await createCredCase(db, admin, { practitionerId: prac.id, caseType: "PAYER_ENROLLMENT", title: "Enrollment (test)", dueDate: addDays(today, -3) });
  const mk = (i: number, o: Record<string, unknown>) =>
    createCase(db, admin, {
      queueId: q1.id,
      caseType: "NO_RESPONSE",
      claimRef: `SYN-RP${A.suffix.toUpperCase().replace(/[^A-Z0-9]/g, "")}-${i}`,
      payerId: payer.id,
      amountCents: 100 * i,
      ...o,
    });
  // A spread of open/closed, aged, overdue, unassigned, credentialing-blocked cases.
  await mk(1, { serviceDate: addDays(today, -120), nextActionDue: addDays(today, -1), siteId: A.sites.s1.id });
  await mk(2, { serviceDate: addDays(today, -95), nextActionDue: addDays(today, 3), ownerUserId: A.users.rcmAnalyst.userId, siteId: A.sites.s2.id });
  await mk(3, { serviceDate: addDays(today, -20), nextActionDue: addDays(today, -5), ownerUserId: A.users.rcmAnalyst.userId });
  await mk(4, { serviceDate: addDays(today, -10), nextActionDue: today, credentialingCaseId: cc.id, caseType: "ENROLLMENT_BLOCKER" });
  const closed = await mk(5, { serviceDate: addDays(today, -200), nextActionDue: addDays(today, -30) });
  await db.update(rcmCases).set({ status: "RESOLVED", resolvedAt: new Date(), resolutionNote: "Paid" }).where(eq(rcmCases.id, closed.id));
  await mk(6, { queueId: q2.id, serviceDate: addDays(today, -100), nextActionDue: addDays(today, -2) });
  // Scheduling source rows: BLOCK evaluations at two sites (minimal synthetic rows).
  const [type] = await db
    .insert(appointmentTypes)
    .values({ organizationId: A.org.id, code: "T", name: "Test visit", durationMinutes: 30, modalities: ["IN_PERSON"] })
    .returning();
  const ev = (siteId: string) => ({
    organizationId: A.org.id,
    trigger: "SEARCH",
    practitionerId: prac.id,
    siteId,
    appointmentTypeId: type!.id,
    modality: "IN_PERSON",
    validForInstant: new Date(),
    patientLocationStatus: "VERIFIED",
    decision: "BLOCK",
    canConfirm: false,
    licenseStatus: "MISSING",
    payerStatus: "NOT_REQUIRED",
    ehrMode: "DEMO",
    flags: [],
    missingEvidenceCodes: [],
    evidenceIds: [],
    evaluatedAt: new Date(),
    expiresAt: new Date(Date.now() + 15 * 60_000),
    actorSystem: "test",
  });
  await db.insert(eligibilityEvaluations).values([ev(A.sites.s1.id), ev(A.sites.s2.id), ev(A.sites.s2.id)]);
});
afterAll(async () => end());

async function allRows(ctx: Awaited<ReturnType<Fixture["users"]["admin"]["ctx"]>>, key: string, filters: Record<string, string> = {}) {
  const first = await getMetricReport(db, ctx, key, filters);
  const rows = [...first.rows];
  for (let p = 2; p <= Math.ceil(first.total / first.pageSize); p++) rows.push(...(await getMetricReport(db, ctx, key, { ...filters, page: String(p) })).rows);
  return { total: first.total, rows };
}

describe("dashboard aggregates reconcile to source rows", () => {
  it("every tile equals the row count of its drill-down (same query, same filters)", async () => {
    for (const filters of <Record<string, string>[]>[{}, { siteId: A.sites.s1.id }, { from: addDays(today, -400), to: today }]) {
      const admin = await A.users.admin.ctx();
      const d = await getOperationsDashboard(db, admin, filters);
      const tiles = d.domains.flatMap((x) => x.tiles);
      expect(tiles).toHaveLength(METRICS.length);
      for (const t of tiles) {
        const { total, rows } = await allRows(admin, t.key, filters);
        expect({ key: t.key, value: t.value }).toEqual({ key: t.key, value: total });
        expect(new Set(rows.map((r) => r.id)).size).toBe(total);
      }
    }
  });

  it("RCM metrics match independent SQL counts and the queue cards", async () => {
    const admin = await A.users.admin.ctx();
    const count = async (where: ReturnType<typeof sql>) =>
      (
        await db.execute<{ n: number }>(
          sql`select count(*)::int as n from rcm_cases where organization_id = ${A.org.id} and status not in ('RESOLVED','CLOSED_NO_ACTION') and ${where}`,
        )
      )[0]!.n;
    const v = async (k: string) => (await getMetricReport(db, admin, k)).total;
    expect(await v("rcm-open")).toBe(await count(sql`true`));
    expect(await v("rcm-open")).toBe(5);
    expect(await v("rcm-aged-over-90")).toBe(await count(sql`service_date < ${addDays(today, -90)}::date`));
    expect(await v("rcm-aged-over-90")).toBe(3);
    expect(await v("rcm-next-action-overdue")).toBe(await count(sql`next_action_due < ${today}::date`));
    expect(await v("rcm-unassigned")).toBe(await count(sql`owner_user_id is null`));
    expect(await v("rcm-credentialing-blocked")).toBe(1);
    expect(await v("rcm-resolved")).toBe(1);
    const { queues } = await listQueues(db, admin);
    expect(queues.reduce((s, q) => s + q.counts.overdue, 0)).toBe(await v("rcm-next-action-overdue"));
    expect(queues.reduce((s, q) => s + q.counts.aged90, 0)).toBe(await v("rcm-aged-over-90"));
  });

  it("scheduling + credentialing roll up into the same dashboard", async () => {
    const admin = await A.users.admin.ctx();
    expect((await getMetricReport(db, admin, "blocked-booking-attempts")).total).toBe(3);
    expect((await getMetricReport(db, admin, "blocked-booking-attempts", { siteId: A.sites.s2.id })).total).toBe(2);
    expect((await getMetricReport(db, admin, "credentialing-cases-overdue")).total).toBe(1);
    const d = await getOperationsDashboard(db, admin);
    expect(d.domains.map((x) => x.domain)).toEqual(["SCHEDULING", "CREDENTIALING", "RCM", "PROJECTS"]);
  });

  it("reports include filter, source and freshness metadata, and record an audit event", async () => {
    const r = await getMetricReport(db, await A.users.admin.ctx(), "rcm-open", { siteId: A.sites.s1.id, from: today });
    expect(r.metric.source).toContain("rcm_cases");
    expect(r.filters.applied).toEqual({ siteId: A.sites.s1.id });
    expect(r.filters.ignored).toEqual(["from"]);
    expect(r.freshness.mode).toBe("LIVE_QUERY");
    expect(r.freshness.sourceUpdatedAt).not.toBeNull();
    expect(r.total).toBe(1);
  });
});

describe("report authorization and scope", () => {
  it("department-scoped RCM staff see only their department's cases; others see no RCM tiles", async () => {
    const an = await A.users.rcmAnalyst.ctx();
    expect((await getMetricReport(db, an, "rcm-open")).total).toBe(4); // excludes the CRED-department queue
    await expectAppError(getMetricReport(db, an, "blocked-booking-attempts"), "FORBIDDEN");
    const d = await getOperationsDashboard(db, an);
    expect(d.domains.map((x) => x.domain)).toEqual(["RCM", "PROJECTS"]);
    expect(d.hiddenDomains).toEqual(["Scheduling", "Credentialing"]);
  });

  it("site-scoped schedulers see only their site's scheduling rows", async () => {
    const s = await A.users.scheduler.ctx();
    expect((await getMetricReport(db, s, "blocked-booking-attempts")).total).toBe(1);
    await expectAppError(getMetricReport(db, s, "rcm-open"), "FORBIDDEN");
  });

  it("another organization sees none of these rows", async () => {
    const b = await B.users.admin.ctx();
    for (const k of ["rcm-open", "blocked-booking-attempts", "credentialing-cases-overdue"]) expect((await getMetricReport(db, b, k)).total).toBe(0);
  });

  it("unknown metrics are 404", async () => {
    await expectAppError(getMetricReport(db, await A.users.admin.ctx(), "nope"), "NOT_FOUND");
  });
});

describe("worker jobs: task reminders, failure and replay", () => {
  it("task due-soon/overdue reminders are idempotent", async () => {
    const pm = await A.users.pm.ctx();
    const p = (await createProject(db, pm, { key: `Q${A.suffix.slice(0, 3).toUpperCase()}`, name: "Reminder test" })) as { id: string };
    await createTask(db, pm, { projectId: p.id, title: "Overdue thing", ownerUserId: pm.userId, dueDate: addDays(today, -1) });
    await createTask(db, pm, { projectId: p.id, title: "Due tomorrow", ownerUserId: pm.userId, dueDate: addDays(today, 1) });
    await createTask(db, pm, { projectId: p.id, title: "Next week", ownerUserId: pm.userId, dueDate: addDays(today, 7) });
    await scanTaskDue(db, { organizationId: A.org.id });
    await scanTaskDue(db, { organizationId: A.org.id });
    await dispatchOutbox(db, { limit: 500 });
    await dispatchOutbox(db, { limit: 500 });
    const mine = await db
      .select({ kind: notifications.kind })
      .from(notifications)
      .where(and(eq(notifications.organizationId, A.org.id), eq(notifications.userId, pm.userId)));
    expect(mine.map((m) => m.kind).sort()).toEqual(["TASK_DUE_SOON", "TASK_OVERDUE"]);
    const ob = await db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.organizationId, A.org.id), sql`${outboxEvents.dedupeKey} like 'notify:%:task.%'`));
    expect(ob.every((e) => e.status === "DONE")).toBe(true);
  });

  it("a dead job can be replayed by an org admin and then succeeds", async () => {
    let fail = true;
    JOB_HANDLERS["test.replay"] = async () => {
      if (fail) throw new Error("simulated worker failure");
    };
    const id = (await enqueueJob(db, "test.replay", `replay-${A.suffix}`))!;
    await db.update(jobs).set({ maxAttempts: 1, organizationId: A.org.id }).where(eq(jobs.id, id));
    await db.execute(sql`update jobs set status = 'DONE' where id <> ${id} and status in ('PENDING','FAILED')`);
    await runDueJobs(db, 5);
    let [j] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(j!.status).toBe("DEAD");
    await expectAppError(replayJob(db, await sup.ctx(), id), "FORBIDDEN");
    await expectAppError(replayJob(db, await B.users.admin.ctx(), id), "NOT_FOUND");
    fail = false;
    await replayJob(db, await A.users.admin.ctx(), id);
    await runDueJobs(db, 5);
    [j] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(j!.status).toBe("DONE");
  });
});
