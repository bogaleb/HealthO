import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { auditEvents, notifications, outboxEvents, rcmCaseActions, rcmCases, tasks } from "@projectos/db/schema";
import { createProject } from "@projectos/core";
import { createCase as createCredCase, createPayer, createPlan, createPractitioner, updateCase as updateCredCase } from "@projectos/credentialing";
import { deliverInApp, dispatchOutbox, recoverStaleOutbox, replayOutboxEvent, type Deliverer } from "@projectos/notifications";
import { addDays, todayIn } from "@projectos/shared";
import { makeOrg, testDb, expectAppError, type Fixture } from "../../core/test/helpers";
import {
  addCaseAction,
  assignCase,
  bulkAssign,
  createCase,
  createQueue,
  escalateCase,
  getCaseDetail,
  linkCaseTask,
  listCases,
  listQueues,
  scanRcmDue,
  undoBulkAssign,
  updateCase,
} from "../src";

const { db, end } = testDb();
const today = todayIn("America/New_York");
let A: Fixture;
let B: Fixture;
type U = Awaited<ReturnType<Fixture["user"]>>;
let sup: U;
let analyst2: U;
let credSup: U;
let payerId: string;
let planId: string;
let queueRcm: { id: string };
let queueCred: { id: string };
let n = 0;

const ref = () => `SYN-T${A.suffix.toUpperCase().replace(/[^A-Z0-9]/g, "")}-${++n}`;
const base = (o: Record<string, unknown> = {}) => ({
  queueId: queueRcm.id,
  caseType: "DENIAL",
  claimRef: ref(),
  payerId,
  payerPlanId: planId,
  serviceDate: addDays(today, -40),
  amountCents: 12_345,
  ...o,
});
const auditCount = async (action: string, resourceId?: string, outcome = "ALLOW") =>
  (
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, A.org.id),
          eq(auditEvents.action, action),
          eq(auditEvents.outcome, outcome),
          resourceId ? eq(auditEvents.resourceId, resourceId) : undefined,
        ),
      )
  )[0]!.n;

beforeAll(async () => {
  A = await makeOrg(db, "RC");
  B = await makeOrg(db, "RX");
  sup = await A.user("rcmsup", [{ roleId: A.roleIds.rcm_supervisor!, departmentId: A.depts.rcm.id }]);
  analyst2 = await A.user("rcm2", [{ roleId: A.roleIds.rcm_analyst!, departmentId: A.depts.rcm.id }]);
  credSup = await A.user("credsup", [{ roleId: A.roleIds.rcm_supervisor!, departmentId: A.depts.cred.id }]);
  const admin = await A.users.admin.ctx();
  const p = (await createPayer(db, admin, { code: "TP", name: "Test Payer (SYNTHETIC)" }))!;
  payerId = p.id;
  planId = (await createPlan(db, admin, { payerId, code: "TPP", name: "Test Plan", requiresEnrollment: true }))!.id;
  queueRcm = (await createQueue(db, await sup.ctx(), { name: "Denials", category: "DENIAL_INITIATIVE", departmentId: A.depts.rcm.id, leadUserId: sup.userId, followUpDays: 7 }))!;
  queueCred = (await createQueue(db, await credSup.ctx(), { name: "Cred-dept queue", category: "CREDENTIALING_PAYER", departmentId: A.depts.cred.id }))!;
});
afterAll(async () => end());

describe("RCM cases: create, audit, idempotency", () => {
  it("creates a case with a CREATED action, audit event and queue-default next-action date", async () => {
    const c = await createCase(db, await sup.ctx(), base({ nextAction: "Call payer" }));
    expect(c.ref).toMatch(/^RCM-\d{4,}$/);
    expect(c.nextActionDue).toBe(addDays(today, 7));
    expect(c.ageBucket).toBe("31-60");
    const acts = await db.select().from(rcmCaseActions).where(eq(rcmCaseActions.caseId, c.id));
    expect(acts.map((a) => a.type)).toEqual(["CREATED"]);
    expect(await auditCount("rcm.case.create", c.id)).toBe(1);
  });

  it("rejects real-looking claim numbers (synthetic SYN- references only)", async () => {
    await expectAppError(createCase(db, await sup.ctx(), base({ claimRef: "123456789" })), "VALIDATION_FAILED");
  });

  it("a retried create never duplicates: idempotency key replays, duplicate open claim conflicts", async () => {
    const s = await sup.ctx();
    const input = base();
    const key = `retry-${A.suffix}`;
    const a = await createCase(db, s, input, { idempotencyKey: key });
    const b = await createCase(db, s, input, { idempotencyKey: key });
    expect(b.id).toBe(a.id);
    expect(b.replayed).toBe(true);
    await expectAppError(createCase(db, s, input), "CONFLICT");
    const rows = await db
      .select()
      .from(rcmCases)
      .where(and(eq(rcmCases.organizationId, A.org.id), eq(rcmCases.claimRef, input.claimRef)));
    expect(rows).toHaveLength(1);
    // Once resolved, the same claim can be worked again (new case).
    await updateCase(db, s, a.id, { version: a.version, status: "RESOLVED", resolutionNote: "Paid (synthetic)" });
    const again = await createCase(db, s, input);
    expect(again.id).not.toBe(a.id);
  });

  it("the action timeline is append-only at the database level", async () => {
    const c = await createCase(db, await sup.ctx(), base());
    await expect(db.execute(sql`update rcm_case_actions set note = 'x' where case_id = ${c.id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from rcm_case_actions where case_id = ${c.id}`)).rejects.toThrow();
  });
});

describe("RCM assignment authorization", () => {
  it("analysts may claim unassigned work but not assign to others; denial is audited", async () => {
    const c = await createCase(db, await sup.ctx(), base());
    const r = await A.users.rcmAnalyst.ctx();
    await expectAppError(assignCase(db, r, c.id, { version: c.version, ownerUserId: analyst2.userId }), "FORBIDDEN");
    expect(await auditCount("rcm.case.assign", c.id, "DENY")).toBe(1);
    const claimed = await assignCase(db, r, c.id, { version: c.version, ownerUserId: r.userId });
    expect(claimed.ownerUserId).toBe(r.userId);
    // Another analyst can't take it over or work it.
    const r2 = await analyst2.ctx();
    await expectAppError(assignCase(db, r2, c.id, { version: claimed.version, ownerUserId: r2.userId }), "FORBIDDEN");
    await expectAppError(addCaseAction(db, r2, c.id, { type: "NOTE", note: "hi" }), "FORBIDDEN");
    // Supervisor reassigns; action + audit recorded.
    const re = await assignCase(db, await sup.ctx(), c.id, { version: claimed.version, ownerUserId: r2.userId });
    expect(re.ownerUserId).toBe(r2.userId);
    expect(await auditCount("rcm.case.assign", c.id)).toBe(2);
  });

  it("the assignee must hold rcm.edit for the case's department", async () => {
    const c = await createCase(db, await sup.ctx(), base());
    await expectAppError(assignCase(db, await sup.ctx(), c.id, { version: c.version, ownerUserId: A.users.pm.userId }), "VALIDATION_FAILED");
  });

  it("department scoping: cases in another department's queue are invisible (404) to RCM-department staff", async () => {
    const other = await createCase(db, await credSup.ctx(), base({ queueId: queueCred.id }));
    await expectAppError(getCaseDetail(db, await A.users.rcmAnalyst.ctx(), other.id), "NOT_FOUND");
    await expectAppError(getCaseDetail(db, await sup.ctx(), other.id), "NOT_FOUND");
    const list = await listCases(db, await sup.ctx(), { status: "ALL", pageSize: 200 });
    expect(list.items.some((x) => x.id === other.id)).toBe(false);
    // Another organization can never see it either.
    await expectAppError(getCaseDetail(db, await B.users.admin.ctx(), other.id), "NOT_FOUND");
  });
});

describe("bulk assignment", () => {
  it("is all-or-nothing when any case is outside the caller's scope", async () => {
    const s = await sup.ctx();
    const mine = await createCase(db, s, base());
    const foreign = await createCase(db, await credSup.ctx(), base({ queueId: queueCred.id }));
    // Org admin can see both; the RCM supervisor cannot see the foreign one → nothing changes.
    await expectAppError(bulkAssign(db, s, { caseIds: [mine.id, foreign.id], ownerUserId: analyst2.userId }), "NOT_FOUND");
    // An org admin can see both, but the RCM analyst assignee is not permitted in the CRED department → nothing changes.
    await expectAppError(bulkAssign(db, await A.users.admin.ctx(), { caseIds: [mine.id, foreign.id], ownerUserId: analyst2.userId }), "VALIDATION_FAILED");
    const rows = await db
      .select({ owner: rcmCases.ownerUserId })
      .from(rcmCases)
      .where(sql`${rcmCases.id} in (${mine.id}, ${foreign.id})`);
    expect(rows.every((r) => r.owner === null)).toBe(true);
  });

  it("analysts can't bulk assign; the denial is audited", async () => {
    const c = await createCase(db, await sup.ctx(), base());
    await expectAppError(bulkAssign(db, await A.users.rcmAnalyst.ctx(), { caseIds: [c.id], ownerUserId: analyst2.userId }), "FORBIDDEN");
    expect(await auditCount("rcm.case.bulk_assign", undefined, "DENY")).toBeGreaterThanOrEqual(1);
  });

  it("assigns atomically with batch audit + one notification, and can be undone as a unit", async () => {
    const s = await sup.ctx();
    const cs = [await createCase(db, s, base()), await createCase(db, s, base()), await createCase(db, s, base({ ownerUserId: analyst2.userId }))];
    const r = await bulkAssign(db, s, { caseIds: cs.map((c) => c.id), ownerUserId: analyst2.userId, versions: Object.fromEntries(cs.map((c) => [c.id, c.version])) });
    expect(r).toMatchObject({ assigned: 2, unchanged: 1 });
    expect(await auditCount("rcm.case.bulk_assign", r.batchId)).toBe(1);
    const acts = await db.select().from(rcmCaseActions).where(eq(rcmCaseActions.batchId, r.batchId));
    expect(acts).toHaveLength(2);
    const ob = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.dedupeKey, `notify:${analyst2.userId}:assigned:batch:${r.batchId}`));
    expect(ob).toHaveLength(1);
    const u = await undoBulkAssign(db, s, r.batchId);
    expect(u.restored).toBe(2);
    const after = await db
      .select({ id: rcmCases.id, owner: rcmCases.ownerUserId })
      .from(rcmCases)
      .where(sql`${rcmCases.id} in (${cs[0]!.id}, ${cs[1]!.id}, ${cs[2]!.id})`);
    expect(after.filter((x) => x.owner === null)).toHaveLength(2);
    await expectAppError(undoBulkAssign(db, s, r.batchId), "CONFLICT");
  });

  it("stale versions and later edits block the batch / its undo (nothing changes)", async () => {
    const s = await sup.ctx();
    const c = await createCase(db, s, base());
    await expectAppError(bulkAssign(db, s, { caseIds: [c.id], ownerUserId: analyst2.userId, versions: { [c.id]: c.version - 1 } }), "VERSION_CONFLICT");
    const r = await bulkAssign(db, s, { caseIds: [c.id], ownerUserId: analyst2.userId });
    await addCaseAction(db, await analyst2.ctx(), c.id, { type: "PAYER_CALL", note: "worked after assignment" });
    await expectAppError(undoBulkAssign(db, s, r.batchId), "CONFLICT");
    const [row] = await db.select({ owner: rcmCases.ownerUserId }).from(rcmCases).where(eq(rcmCases.id, c.id));
    expect(row!.owner).toBe(analyst2.userId);
  });
});

describe("follow-ups, escalation and project/credentialing links", () => {
  it("records a follow-up, moves OPEN → IN_PROGRESS and sets the next action", async () => {
    const r = await analyst2.ctx();
    const c = await createCase(db, await sup.ctx(), base({ ownerUserId: r.userId }));
    const a = await addCaseAction(db, r, c.id, { type: "PAYER_CALL", note: "Rep says resubmit (synthetic)", nextAction: "Resubmit" });
    expect(a.status).toBe("IN_PROGRESS");
    expect(a.nextAction).toBe("Resubmit");
    expect(a.nextActionDue).toBe(addDays(today, 7));
    expect(await auditCount("rcm.case.action", c.id)).toBe(1);
  });

  it("escalation notifies the queue lead; non-supervisor targets are rejected", async () => {
    const r = await analyst2.ctx();
    const c = await createCase(db, await sup.ctx(), base({ ownerUserId: r.userId, priority: "LOW" }));
    await expectAppError(escalateCase(db, r, c.id, { version: c.version, reason: "Stuck", escalateToUserId: A.users.rcmAnalyst.userId }), "VALIDATION_FAILED");
    const e = await escalateCase(db, r, c.id, { version: c.version, reason: "Stuck > 120 days" });
    expect(e.status).toBe("ESCALATED");
    expect(e.priority).toBe("HIGH");
    expect(e.escalatedTo).toBe(sup.userId);
    const ob = await db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.organizationId, A.org.id), sql`${outboxEvents.dedupeKey} like ${`notify:${sup.userId}:escalated:${c.id}:%`}`));
    expect(ob).toHaveLength(1);
  });

  it("links a project task once; resolving the case completes the task", async () => {
    const s = await sup.ctx();
    const project = (await createProject(db, await A.users.admin.ctx(), {
      key: `R${A.suffix.slice(0, 3).toUpperCase()}`,
      name: "Reduce A/R (test)",
      departmentId: A.depts.rcm.id,
    })) as { id: string };
    const c = await createCase(db, s, base());
    const { task, case: linked } = await linkCaseTask(db, s, c.id, { projectId: project.id });
    expect(task.labels).toContain("rcm");
    await expectAppError(linkCaseTask(db, s, c.id, { projectId: project.id }), "CONFLICT");
    const done = await updateCase(db, s, c.id, { version: linked.version, status: "RESOLVED", resolutionNote: "Paid" });
    expect(done.taskSync).toBe("DONE");
    const [t] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(t!.status).toBe("DONE");
  });

  it("links (not copies) a credentialing case; detail reflects the credentialing status live", async () => {
    const admin = await A.users.admin.ctx();
    const prac = await createPractitioner(db, admin, { displayName: "Practitioner RC (SYNTHETIC)", profession: "PHYSICIAN", siteIds: [A.sites.s1.id] });
    const cc = await createCredCase(db, admin, { practitionerId: prac.id, caseType: "PAYER_ENROLLMENT", title: "Enroll in Test Plan", dueDate: addDays(today, 10) });
    const c = await createCase(db, await sup.ctx(), base({ caseType: "ENROLLMENT_BLOCKER", credentialingCaseId: cc.id }));
    expect(c.practitionerId).toBe(prac.id);
    let d = await getCaseDetail(db, await sup.ctx(), c.id);
    expect(d.credentialingCase?.status).toBe("OPEN");
    await updateCredCase(db, admin, cc.id, { version: cc.version, status: "COMPLETED" });
    d = await getCaseDetail(db, await sup.ctx(), c.id);
    expect(d.credentialingCase?.status).toBe("COMPLETED");
  });

  it("queue counts match the list filters behind them", async () => {
    const s = await sup.ctx();
    const { queues } = await listQueues(db, s);
    for (const q of queues) {
      const open = await listCases(db, s, { queueId: q.id, pageSize: 1 });
      const overdue = await listCases(db, s, { queueId: q.id, due: "overdue", pageSize: 1 });
      const unassigned = await listCases(db, s, { queueId: q.id, owner: "none", pageSize: 1 });
      const aged = await listCases(db, s, { queueId: q.id, age: "over90", pageSize: 1 });
      expect([open.total, overdue.total, unassigned.total, aged.total]).toEqual([q.counts.open, q.counts.overdue, q.counts.unassigned, q.counts.aged90]);
    }
  });
});

describe("due-soon/overdue notifications via the outbox", () => {
  const myNotifications = async (userId: string) =>
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.organizationId, A.org.id), eq(notifications.userId, userId)));

  it("scans idempotently and delivers exactly once, even when scanned and dispatched repeatedly", async () => {
    const owner = await A.user("rcmn", [{ roleId: A.roleIds.rcm_analyst!, departmentId: A.depts.rcm.id }]);
    const s = await sup.ctx();
    const overdue = await createCase(db, s, base({ ownerUserId: owner.userId, nextAction: "Call", nextActionDue: addDays(today, -2) }));
    await createCase(db, s, base({ ownerUserId: owner.userId, nextAction: "Check", nextActionDue: today }));
    await createCase(db, s, base({ ownerUserId: owner.userId, nextAction: "Later", nextActionDue: addDays(today, 9) }));
    await scanRcmDue(db, { organizationId: A.org.id });
    await scanRcmDue(db, { organizationId: A.org.id });
    await dispatchOutbox(db, { limit: 500 });
    await dispatchOutbox(db, { limit: 500 });
    let mine = (await myNotifications(owner.userId)).filter((x) => x.kind !== "RCM_ASSIGNED");
    expect(mine.map((x) => x.kind).sort()).toEqual(["RCM_DUE_SOON", "RCM_OVERDUE"]);
    // Moving the due date re-arms the reminder (new key), still exactly one per date.
    const [row] = await db.select().from(rcmCases).where(eq(rcmCases.id, overdue.id));
    await updateCase(db, s, overdue.id, { version: row!.version, nextActionDue: addDays(today, -1) });
    await scanRcmDue(db, { organizationId: A.org.id });
    await scanRcmDue(db, { organizationId: A.org.id });
    await dispatchOutbox(db, { limit: 500 });
    mine = (await myNotifications(owner.userId)).filter((x) => x.kind === "RCM_OVERDUE");
    expect(mine).toHaveLength(2);
  });

  it("unassigned overdue work notifies the queue lead", async () => {
    const c = await createCase(db, await sup.ctx(), base({ nextActionDue: addDays(today, -3) }));
    await scanRcmDue(db, { organizationId: A.org.id });
    const ob = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.dedupeKey, `notify:${sup.userId}:rcm.overdue:${c.id}:${addDays(today, -3)}`));
    expect(ob).toHaveLength(1);
  });

  it("worker failure → retries → DEAD; admin replay delivers exactly once (no duplicate after a crash)", async () => {
    const owner = await A.user("rcmf", [{ roleId: A.roleIds.rcm_analyst!, departmentId: A.depts.rcm.id }]);
    await createCase(db, await sup.ctx(), base({ ownerUserId: owner.userId, nextAction: "Fail me", nextActionDue: addDays(today, -1) }));
    await dispatchOutbox(db, { limit: 500 }); // flush unrelated pending rows
    await scanRcmDue(db, { organizationId: A.org.id });
    const [ev] = await db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.organizationId, A.org.id), sql`${outboxEvents.dedupeKey} like ${`notify:${owner.userId}:rcm.overdue:%`}`));
    expect(ev!.status).toBe("PENDING");
    await db.update(outboxEvents).set({ maxAttempts: 2 }).where(eq(outboxEvents.id, ev!.id));
    const failing: Deliverer = async (d, e) => {
      if (e.id === ev!.id) throw new Error("simulated delivery failure");
      return deliverInApp(d, e);
    };
    await dispatchOutbox(db, { deliver: failing, limit: 500 });
    let [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, ev!.id));
    expect(row!.status).toBe("FAILED");
    expect(row!.lastError).toContain("simulated");
    await db
      .update(outboxEvents)
      .set({ availableAt: new Date(Date.now() - 1000) })
      .where(eq(outboxEvents.id, ev!.id));
    await dispatchOutbox(db, { deliver: failing, limit: 500 });
    [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, ev!.id));
    expect(row!.status).toBe("DEAD");
    expect((await myNotifications(owner.userId)).filter((x) => x.kind === "RCM_OVERDUE")).toHaveLength(0);

    // Only org admins may replay; the replay is audited.
    await expectAppError(replayOutboxEvent(db, await sup.ctx(), ev!.id), "FORBIDDEN");
    await replayOutboxEvent(db, await A.users.admin.ctx(), ev!.id);
    expect(await auditCount("outbox.replay", ev!.id)).toBe(1);
    // Simulate a crash after delivery but before DONE: deliver now, leave the row PROCESSING and stale.
    await deliverInApp(db, row!);
    await db
      .update(outboxEvents)
      .set({ status: "PROCESSING", lockedAt: new Date(Date.now() - 60 * 60_000) })
      .where(eq(outboxEvents.id, ev!.id));
    expect(await recoverStaleOutbox(db)).toBeGreaterThanOrEqual(1);
    await db
      .update(outboxEvents)
      .set({ availableAt: new Date(Date.now() - 1000) })
      .where(eq(outboxEvents.id, ev!.id));
    await dispatchOutbox(db, { limit: 500 });
    [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, ev!.id));
    expect(row!.status).toBe("DONE");
    expect((await myNotifications(owner.userId)).filter((x) => x.kind === "RCM_OVERDUE")).toHaveLength(1);
  });
});
