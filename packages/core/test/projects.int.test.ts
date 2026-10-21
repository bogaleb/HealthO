import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { tasks } from "@projectos/db/schema";
import { createProject, getProject, getProjectDetail, listProjects, updateProject, listTemplates } from "../src/projects/projects";
import { addChecklistItem, addComment, addDependency, createTask, deleteTask, getBoard, getMyWork, getTaskDetail, listTasks, moveTask, updateTask } from "../src/projects/tasks";
import { createRecurringDefinition, generateRecurringTasks } from "../src/projects/recurring";
import { projectTemplates } from "@projectos/db/schema";
import { addDays, todayIn } from "@projectos/shared";
import { expectAppError, makeOrg, testDb, type Fixture } from "./helpers";

const { db, end } = testDb();
let A: Fixture;
beforeAll(async () => {
  A = await makeOrg(db, "P");
});
afterAll(async () => end());

describe("projects CRUD + permissions", () => {
  it("creates, reads, updates with version check", async () => {
    const pm = await A.users.pm.ctx();
    const p = (await createProject(db, pm, { key: "CRUD", name: "CRUD project", startDate: "2026-11-01", dueDate: "2026-12-01" }))!;
    expect(p.ownerUserId).toBe(pm.userId);
    const u = (await updateProject(db, pm, p.id, { health: "AT_RISK", version: p.version }))!;
    expect(u.health).toBe("AT_RISK");
    await expectAppError(updateProject(db, pm, p.id, { health: "OFF_TRACK", version: p.version }), "VERSION_CONFLICT");
    await expectAppError(createProject(db, pm, { key: "CRUD", name: "dup" }), "CONFLICT");
    await expectAppError(createProject(db, pm, { key: "DATES", name: "bad", startDate: "2026-12-01", dueDate: "2026-11-01" }), "VALIDATION_FAILED");
  });

  it("department-scoped users see only their department's projects and cannot edit others", async () => {
    const admin = await A.users.admin.ctx();
    const rcm = await A.users.rcmAnalyst.ctx();
    const rcmProj = (await createProject(db, admin, { key: "RCMP", name: "RCM project", departmentId: A.depts.rcm.id }))!;
    const credProj = (await createProject(db, admin, { key: "CREDP", name: "Cred project", departmentId: A.depts.cred.id }))!;
    const visible = await listProjects(db, rcm);
    expect(visible.map((p) => p.key)).toContain("RCMP");
    expect(visible.map((p) => p.key)).not.toContain("CREDP");
    await expectAppError(getProject(db, rcm, credProj.id), "NOT_FOUND");
    const { task } = await createTask(db, rcm, { projectId: rcmProj.id, title: "Allowed" });
    expect(task.projectId).toBe(rcmProj.id);
    await expectAppError(createTask(db, rcm, { projectId: credProj.id, title: "Denied" }), "NOT_FOUND");
    // creating a project outside your scope is forbidden
    await expectAppError(createProject(db, rcm, { key: "OUT", name: "Out of scope", departmentId: A.depts.cred.id }), "FORBIDDEN");
  });

  it("read-only users cannot mutate tasks", async () => {
    const admin = await A.users.admin.ctx();
    const p = (await createProject(db, admin, { key: "RO", name: "RO" }))!;
    const { task } = await createTask(db, admin, { projectId: p.id, title: "t" });
    const auditor = await A.users.auditor.ctx(); // projects.read only
    await getTaskDetail(db, auditor, task.id);
    await expectAppError(updateTask(db, auditor, task.id, { title: "x", version: task.version }), "FORBIDDEN");
    await expectAppError(moveTask(db, auditor, task.id, { status: "DONE", version: task.version }), "FORBIDDEN");
  });

  it("creates projects from a department template with milestones and tasks", async () => {
    const admin = await A.users.admin.ctx();
    const [tpl] = await db
      .insert(projectTemplates)
      .values({ organizationId: A.org.id, name: "T1", milestones: [{ name: "M1", offsetDays: 5 }], tasks: [{ title: "first", offsetDays: 1, milestone: "M1" }, { title: "second" }] })
      .returning();
    const p = (await createProject(db, admin, { key: "TPL", name: "From template", startDate: "2026-11-02", templateId: tpl!.id }))!;
    const d = await getProjectDetail(db, admin, p.id);
    expect(d.milestones).toHaveLength(1);
    const list = await listTasks(db, admin, { projectId: p.id });
    expect(list.total).toBe(2);
    expect(list.items.find((t) => t.title === "first")!.dueDate).toBe("2026-11-03");
    const next = await createTask(db, admin, { projectId: p.id, title: "third" });
    expect(next.task.number).toBe(3);
    expect((await listTemplates(db, admin)).length).toBeGreaterThan(0);
  });
});

describe("PROJ-01 board status persists", () => {
  it("move persists status + order, logs activity and audit", async () => {
    const pm = await A.users.pm.ctx();
    const p = (await createProject(db, pm, { key: "BRD", name: "Board" }))!;
    const t1 = (await createTask(db, pm, { projectId: p.id, title: "one" })).task;
    const t2 = (await createTask(db, pm, { projectId: p.id, title: "two" })).task;
    const t3 = (await createTask(db, pm, { projectId: p.id, title: "three" })).task;
    await moveTask(db, pm, t1.id, { status: "IN_PROGRESS", version: t1.version });
    await moveTask(db, pm, t2.id, { status: "IN_PROGRESS", version: t2.version });
    // drop t3 before t2 in IN_PROGRESS
    await moveTask(db, pm, t3.id, { status: "IN_PROGRESS", beforeTaskId: t2.id, version: t3.version });
    const board = await getBoard(db, pm, p.id);
    const col = board.tasks.filter((t) => t.status === "IN_PROGRESS").map((t) => t.title);
    expect(col).toEqual(["one", "three", "two"]);
    const detail = await getTaskDetail(db, pm, t3.id);
    expect(detail.events.some((e) => e.type === "STATUS_CHANGED" && e.toValue === "IN_PROGRESS")).toBe(true);
    // stale version from a second tab
    await expectAppError(moveTask(db, pm, t1.id, { status: "DONE", version: t1.version }), "VERSION_CONFLICT");
  });

  it("DONE sets completedAt and leaving DONE clears it", async () => {
    const pm = await A.users.pm.ctx();
    const p = (await createProject(db, pm, { key: "CMP", name: "Complete" }))!;
    const t = (await createTask(db, pm, { projectId: p.id, title: "x" })).task;
    const done = await moveTask(db, pm, t.id, { status: "DONE", version: t.version });
    expect(done.completedAt).not.toBeNull();
    const back = await moveTask(db, pm, t.id, { status: "TODO", version: done.version });
    expect(back.completedAt).toBeNull();
  });
});

describe("PROJ-02 dependencies", () => {
  it("rejects self, cycles (direct and transitive) and completing a blocked task", async () => {
    const pm = await A.users.pm.ctx();
    const p = (await createProject(db, pm, { key: "DEP", name: "Deps" }))!;
    const [a, b, c] = await Promise.all(["A", "B", "C"].map(async (title) => (await createTask(db, pm, { projectId: p.id, title })).task));
    await expectAppError(addDependency(db, pm, a!.id, { blockingTaskId: a!.id }), "DEPENDENCY_CYCLE");
    await addDependency(db, pm, b!.id, { blockingTaskId: a!.id }); // A blocks B
    await addDependency(db, pm, c!.id, { blockingTaskId: b!.id }); // B blocks C
    await expectAppError(addDependency(db, pm, a!.id, { blockingTaskId: c!.id }), "DEPENDENCY_CYCLE"); // C blocks A => cycle
    await expectAppError(addDependency(db, pm, a!.id, { blockingTaskId: b!.id }), "DEPENDENCY_CYCLE");
    // RELATED links never form a "cycle"
    await addDependency(db, pm, a!.id, { blockingTaskId: c!.id, kind: "RELATED" });
    const cDetail = await getTaskDetail(db, pm, c!.id);
    expect(cDetail.isBlocked).toBe(true);
    await expectAppError(moveTask(db, pm, c!.id, { status: "DONE", version: c!.version }), "TASK_BLOCKED");
    const aDone = await moveTask(db, pm, a!.id, { status: "DONE", version: a!.version });
    expect(aDone.status).toBe("DONE");
    const bFresh = (await getTaskDetail(db, pm, b!.id)).task;
    await moveTask(db, pm, b!.id, { status: "DONE", version: bFresh.version });
    await moveTask(db, pm, c!.id, { status: "DONE", version: c!.version });
  });

  it("concurrent opposite edges cannot both succeed (advisory lock)", async () => {
    const pm = await A.users.pm.ctx();
    const p = (await createProject(db, pm, { key: "RACE", name: "Race" }))!;
    const x = (await createTask(db, pm, { projectId: p.id, title: "x" })).task;
    const y = (await createTask(db, pm, { projectId: p.id, title: "y" })).task;
    const results = await Promise.allSettled([addDependency(db, pm, x.id, { blockingTaskId: y.id }), addDependency(db, pm, y.id, { blockingTaskId: x.id })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("subtasks, comments, checklist", () => {
  it("allows max two levels and records comments/checklist", async () => {
    const pm = await A.users.pm.ctx();
    const p = (await createProject(db, pm, { key: "SUB", name: "Sub" }))!;
    const parent = (await createTask(db, pm, { projectId: p.id, title: "parent" })).task;
    const child = (await createTask(db, pm, { projectId: p.id, title: "child", parentTaskId: parent.id })).task;
    expect(child.depth).toBe(1);
    await expectAppError(createTask(db, pm, { projectId: p.id, title: "grandchild", parentTaskId: child.id }), "VALIDATION_FAILED");
    await addComment(db, pm, parent.id, { body: "Synthetic comment" });
    await addChecklistItem(db, pm, parent.id, { text: "step" });
    const d = await getTaskDetail(db, pm, parent.id);
    expect(d.subtasks).toHaveLength(1);
    expect(d.comments).toHaveLength(1);
    expect(d.checklist).toHaveLength(1);
    await deleteTask(db, pm, parent.id);
    await expectAppError(getTaskDetail(db, pm, child.id), "NOT_FOUND");
  });
});

describe("idempotent create (duplicate retry)", () => {
  it("same idempotency key → one task, sequential and concurrent", async () => {
    const pm = await A.users.pm.ctx();
    const p = (await createProject(db, pm, { key: "IDEM", name: "Idem" }))!;
    const first = await createTask(db, pm, { projectId: p.id, title: "retry me" }, { idempotencyKey: "key-1" });
    const second = await createTask(db, pm, { projectId: p.id, title: "retry me" }, { idempotencyKey: "key-1" });
    expect(second.replayed).toBe(true);
    expect(second.task.id).toBe(first.task.id);
    const racers = await Promise.all(Array.from({ length: 5 }, () => createTask(db, pm, { projectId: p.id, title: "race" }, { idempotencyKey: "key-2" })));
    expect(new Set(racers.map((r) => r.task.id)).size).toBe(1);
    const rows = await db.select().from(tasks).where(and(eq(tasks.projectId, p.id)));
    expect(rows).toHaveLength(2);
  });
});

describe("recurring tasks", () => {
  it("generation is idempotent across repeated and concurrent runs", async () => {
    const pm = await A.users.pm.ctx();
    const p = (await createProject(db, pm, { key: "REC", name: "Recurring" }))!;
    const now = new Date("2026-11-20T15:00:00Z");
    const today = todayIn("America/New_York", now);
    await createRecurringDefinition(db, pm, { projectId: p.id, title: "Daily huddle notes", cadence: "DAILY", timezone: "America/New_York", startOn: addDays(today, -2) });
    await createRecurringDefinition(db, pm, { projectId: p.id, title: "Weekly review", cadence: "WEEKLY", weekday: new Date(`${today}T00:00:00Z`).getUTCDay(), timezone: "America/New_York", startOn: addDays(today, -6) });
    const r1 = await generateRecurringTasks(db, { organizationId: A.org.id, now });
    expect(r1.created).toBe(4); // 3 daily (today-2..today) + 1 weekly
    const r2 = await generateRecurringTasks(db, { organizationId: A.org.id, now });
    expect(r2.created).toBe(0);
    const later = new Date("2026-11-21T15:00:00Z");
    const results = await Promise.all([generateRecurringTasks(db, { organizationId: A.org.id, now: later }), generateRecurringTasks(db, { organizationId: A.org.id, now: later })]);
    expect(results[0].created + results[1].created).toBe(1);
    const list = await listTasks(db, pm, { projectId: p.id, pageSize: 100 });
    expect(list.total).toBe(5);
  });
});

describe("list filters, pagination and my work", () => {
  it("filters and paginates; my-work groups by due date", async () => {
    const pm = await A.users.pm.ctx();
    const p = (await createProject(db, pm, { key: "LST", name: "List" }))!;
    const today = todayIn("America/New_York");
    for (let i = 0; i < 12; i++) {
      await createTask(db, pm, { projectId: p.id, title: `Item ${i}`, priority: i % 2 ? "HIGH" : "LOW", ownerUserId: pm.userId, dueDate: addDays(today, i - 3), labels: i % 3 === 0 ? ["triage"] : [] });
    }
    const page2 = await listTasks(db, pm, { projectId: p.id, page: 2, pageSize: 5 });
    expect(page2.total).toBe(12);
    expect(page2.items).toHaveLength(5);
    expect((await listTasks(db, pm, { projectId: p.id, priority: "HIGH" })).total).toBe(6);
    expect((await listTasks(db, pm, { projectId: p.id, label: "triage" })).total).toBe(4);
    expect((await listTasks(db, pm, { projectId: p.id, q: "Item 1" })).total).toBe(3); // 1, 10, 11
    const mw = await getMyWork(db, pm);
    expect(mw.overdue.filter((t) => t.projectId === p.id)).toHaveLength(3);
    expect(mw.dueToday.filter((t) => t.projectId === p.id)).toHaveLength(1);
    await expectAppError(listTasks(db, pm, { pageSize: 1000 }), "VALIDATION_FAILED");
  });
});
