import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { auditEvents, memberships, sites } from "@projectos/db/schema";
import { loadAuthContext } from "@projectos/auth";
import { acceptInvite, createInvite, createRole, createSite, getSite, listMembers, listAuditEvents, setRoles, updateMembership, updateSite } from "../src";
import { createProject, getProject } from "../src/projects/projects";
import { addDependency, createTask, getTaskDetail, updateTask } from "../src/projects/tasks";
import { expectAppError, makeOrg, testDb, type Fixture } from "./helpers";

const { db, end } = testDb();
let A: Fixture;
let B: Fixture;

beforeAll(async () => {
  A = await makeOrg(db, "A");
  B = await makeOrg(db, "B"); // second synthetic organization: integration tests only
});
afterAll(async () => end());

describe("SEC-01 organization comes from the session, never the body", () => {
  it("ignores a forged organizationId and writes to the caller's org", async () => {
    const ctx = await A.users.admin.ctx();
    const site = await createSite(db, ctx, { code: "FORGE", name: "Forged attempt", state: "VA", timezone: "America/New_York", organizationId: B.org.id });
    expect(site!.organizationId).toBe(A.org.id);
    const inB = await db.select().from(sites).where(and(eq(sites.organizationId, B.org.id), eq(sites.code, "FORGE")));
    expect(inB).toHaveLength(0);
  });
});

describe("cross-organization isolation (synthetic second org)", () => {
  it("cannot read or mutate another org's site, project or task (404, not 403, to prevent enumeration)", async () => {
    const actx = await A.users.admin.ctx();
    const bctx = await B.users.admin.ctx();
    const p = (await createProject(db, actx, { key: "ISO", name: "Isolation" }))!;
    const { task } = await createTask(db, actx, { projectId: p.id, title: "Org A task" });
    await expectAppError(getSite(db, bctx, A.sites.s1.id), "NOT_FOUND");
    await expectAppError(updateSite(db, bctx, A.sites.s1.id, { name: "pwned", version: 1 }), "NOT_FOUND");
    await expectAppError(getProject(db, bctx, p.id), "NOT_FOUND");
    await expectAppError(getTaskDetail(db, bctx, task.id), "NOT_FOUND");
    await expectAppError(updateTask(db, bctx, task.id, { title: "pwned", version: 1 }), "NOT_FOUND");
    await expectAppError(createTask(db, bctx, { projectId: p.id, title: "inject" }), "NOT_FOUND");
  });

  it("rejects linking a dependency to another org's task", async () => {
    const actx = await A.users.admin.ctx();
    const bctx = await B.users.admin.ctx();
    const pa = (await createProject(db, actx, { key: "XA", name: "XA" }))!;
    const pb = (await createProject(db, bctx, { key: "XB", name: "XB" }))!;
    const ta = (await createTask(db, actx, { projectId: pa.id, title: "a" })).task;
    const tb = (await createTask(db, bctx, { projectId: pb.id, title: "b" })).task;
    await expectAppError(addDependency(db, bctx, tb.id, { blockingTaskId: ta.id }), "NOT_FOUND");
  });

  it("rejects assigning a task owner from another org", async () => {
    const actx = await A.users.admin.ctx();
    const p = (await createProject(db, actx, { key: "OWN", name: "Owners" }))!;
    await expectAppError(createTask(db, actx, { projectId: p.id, title: "x", ownerUserId: B.users.pm.userId }), "VALIDATION_FAILED");
  });

  it("rejects referencing another org's site on a project", async () => {
    const actx = await A.users.admin.ctx();
    await expectAppError(createProject(db, actx, { key: "XSITE", name: "x", siteId: B.sites.s1.id }), "VALIDATION_FAILED");
  });
});

describe("stale membership", () => {
  it("a suspended membership yields no auth context (requests become 403) and reactivation restores it", async () => {
    const admin = await A.users.admin.ctx();
    const target = await A.user("stale", [{ roleId: A.roleIds.project_manager! }]);
    expect(await loadAuthContext(db, target.userId)).not.toBeNull();
    const [m] = await db.select().from(memberships).where(eq(memberships.id, target.membershipId));
    await updateMembership(db, admin, target.membershipId, { status: "SUSPENDED", version: m!.version });
    expect(await loadAuthContext(db, target.userId)).toBeNull();
    await updateMembership(db, admin, target.membershipId, { status: "ACTIVE", version: m!.version + 1 });
    expect(await loadAuthContext(db, target.userId)).not.toBeNull();
  });

  it("role changes take effect on the next request (no cached grants)", async () => {
    const admin = await A.users.admin.ctx();
    const target = await A.user("demote", [{ roleId: A.roleIds.project_manager! }]);
    const before = await target.ctx();
    expect(before.grants.some((g) => g.permission === "projects.edit")).toBe(true);
    const [m] = await db.select().from(memberships).where(eq(memberships.id, target.membershipId));
    await setRoles(db, admin, target.membershipId, { grants: [{ roleId: A.roleIds.read_only! }], version: m!.version });
    const after = await target.ctx();
    expect(after.grants.some((g) => g.permission === "projects.edit")).toBe(false);
  });
});

describe("unauthorized site mutation", () => {
  it("a site-scoped scheduler cannot create sites; denial is audited", async () => {
    const ctx = await A.users.scheduler.ctx();
    await expectAppError(createSite(db, ctx, { code: "NOPE", name: "No", state: "VA", timezone: "America/New_York" }), "FORBIDDEN");
    const denies = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, A.org.id), eq(auditEvents.actorUserId, ctx.userId), eq(auditEvents.action, "site.create"), eq(auditEvents.outcome, "DENY")));
    expect(denies.length).toBe(1);
    expect(JSON.stringify(denies[0]!.metadata)).not.toMatch(/NOPE|No/);
  });

  it("a site-scoped site manager may edit only their own site", async () => {
    const admin = await A.users.admin.ctx();
    const role = (await createRole(db, admin, { name: "Site manager S1", permissions: ["sites.manage", "projects.read"] }))!;
    const mgr = await A.user("sitemgr", [{ roleId: role.id, siteId: A.sites.s1.id }]);
    const ctx = await mgr.ctx();
    const s1 = await getSite(db, ctx, A.sites.s1.id);
    const updated = await updateSite(db, ctx, s1.id, { name: "Site One (renamed)", version: s1.version });
    expect(updated!.name).toBe("Site One (renamed)");
    const s2 = await getSite(db, ctx, A.sites.s2.id);
    await expectAppError(updateSite(db, ctx, s2.id, { name: "nope", version: s2.version }), "FORBIDDEN");
  });

  it("optimistic version conflict on concurrent site edit", async () => {
    const admin = await A.users.admin.ctx();
    const s = await getSite(db, admin, A.sites.s2.id);
    await updateSite(db, admin, s.id, { city: "Bethesda", version: s.version });
    await expectAppError(updateSite(db, admin, s.id, { city: "Rockville", version: s.version }), "VERSION_CONFLICT");
  });

  it("validates state code and IANA timezone", async () => {
    const admin = await A.users.admin.ctx();
    await expectAppError(createSite(db, admin, { code: "BAD", name: "Bad", state: "ZZ", timezone: "America/New_York" }), "VALIDATION_FAILED");
    await expectAppError(createSite(db, admin, { code: "BAD", name: "Bad", state: "VA", timezone: "Mars/Olympus" }), "VALIDATION_FAILED");
  });
});

describe("role escalation", () => {
  it("a user manager without org-wide permissions cannot grant roles exceeding their own", async () => {
    const admin = await A.users.admin.ctx();
    const role = (await createRole(db, admin, { name: "HR user manager", permissions: ["users.manage", "projects.read"] }))!;
    const hr = await A.user("hr", [{ roleId: role.id }]);
    const hrCtx = await hr.ctx();
    const victim = await A.user("victim", [{ roleId: A.roleIds.read_only! }]);
    const [m] = await db.select().from(memberships).where(eq(memberships.id, victim.membershipId));
    await expectAppError(setRoles(db, hrCtx, victim.membershipId, { grants: [{ roleId: A.roleIds.org_admin! }], version: m!.version }), "ROLE_ESCALATION");
    // Granting what they hold is allowed
    await setRoles(db, hrCtx, victim.membershipId, { grants: [{ roleId: A.roleIds.read_only! }], version: m!.version });
  });

  it("nobody can change their own roles", async () => {
    const admin = await A.users.admin.ctx();
    const [m] = await db.select().from(memberships).where(eq(memberships.id, admin.membershipId));
    await expectAppError(setRoles(db, admin, admin.membershipId, { grants: [{ roleId: A.roleIds.org_admin! }], version: m!.version }), "ROLE_ESCALATION");
  });

  it("a role with org-wide-only permissions cannot be scoped to a site", async () => {
    const admin = await A.users.admin.ctx();
    const victim = await A.user("scoped", [{ roleId: A.roleIds.read_only! }]);
    const [m] = await db.select().from(memberships).where(eq(memberships.id, victim.membershipId));
    await expectAppError(setRoles(db, admin, victim.membershipId, { grants: [{ roleId: A.roleIds.auditor!, siteId: A.sites.s1.id }], version: m!.version }), "VALIDATION_FAILED");
  });

  it("non-admins cannot create roles or list members", async () => {
    const pm = await A.users.pm.ctx();
    await expectAppError(createRole(db, pm, { name: "Sneaky", permissions: ["projects.read"] }), "FORBIDDEN");
    await expectAppError(listMembers(db, pm), "FORBIDDEN");
  });

  it("cannot grant another org's role", async () => {
    const admin = await A.users.admin.ctx();
    const victim = await A.user("xorg", [{ roleId: A.roleIds.read_only! }]);
    const [m] = await db.select().from(memberships).where(eq(memberships.id, victim.membershipId));
    await expectAppError(setRoles(db, admin, victim.membershipId, { grants: [{ roleId: B.roleIds.read_only! }], version: m!.version }), "VALIDATION_FAILED");
  });
});

describe("invites", () => {
  it("invite → accept creates an active member with the granted scoped role; token is single-use", async () => {
    const admin = await A.users.admin.ctx();
    const inv = await createInvite(db, admin, { email: `New.Hire-${A.suffix}@Test.Example`, displayName: "New Hire", grants: [{ roleId: A.roleIds.scheduler!, siteId: A.sites.s2.id }] });
    expect(inv.token.length).toBeGreaterThan(30);
    await acceptInvite(db, { token: inv.token, password: "a-long-synthetic-password" }, async () => "hash");
    await expectAppError(acceptInvite(db, { token: inv.token, password: "a-long-synthetic-password" }, async () => "hash"), "INVITE_INVALID");
    const members = await listMembers(db, admin);
    const nh = members.find((m) => m.email === `new.hire-${A.suffix}@test.example`)!;
    expect(nh.status).toBe("ACTIVE");
    expect(nh.grants[0]!.siteId).toBe(A.sites.s2.id);
  });

  it("an unknown token is rejected without detail", async () => {
    await expectAppError(acceptInvite(db, { token: "x".repeat(43), password: "a-long-synthetic-password" }, async () => "hash"), "INVITE_INVALID");
  });
});

describe("audit", () => {
  it("audit_events is append-only at the database level", async () => {
    const cause = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e) {
        const err = e as { message: string; cause?: { message?: string } };
        return `${err.message} ${err.cause?.message ?? ""}`;
      }
      return "no error";
    };
    expect(await cause(db.execute(sql`update audit_events set action = 'tampered'`))).toMatch(/append-only/);
    expect(await cause(db.execute(sql`delete from audit_events`))).toMatch(/append-only/);
  });

  it("only audit.read holders can read audit events, scoped to their org", async () => {
    const pm = await A.users.pm.ctx();
    await expectAppError(listAuditEvents(db, pm, {}), "FORBIDDEN");
    const auditor = await A.users.auditor.ctx();
    const r = await listAuditEvents(db, auditor, { pageSize: 100 });
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((e) => e.organizationId === A.org.id)).toBe(true);
  });
});
