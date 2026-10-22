import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { auditEvents, complianceItems, opsDrills } from "@projectos/db/schema";
import { makeOrg, testDb, expectAppError, type Fixture } from "../../core/test/helpers";
import { COMPLIANCE_CATALOG, READINESS_NOT_APPROVED, getReadiness, isPrivileged, listComplianceItems, mfaRequiredForPrivileged, recordDrill, updateComplianceItem } from "../src";
import { runClinicDayRehearsal } from "../src/rehearsal";

const { db, end } = testDb();
let A: Fixture;
let officer: Awaited<ReturnType<Fixture["user"]>>;
let officer2: Awaited<ReturnType<Fixture["user"]>>;

beforeAll(async () => {
  A = await makeOrg(db, "CO");
  officer = await A.user("compliance1", [{ roleId: A.roleIds.compliance_officer! }]);
  officer2 = await A.user("compliance2", [{ roleId: A.roleIds.compliance_officer! }]);
});
afterAll(async () => end());

describe("PHI readiness checklist", () => {
  it("creates the catalog once and defaults to NOT APPROVED FOR REAL PHI", async () => {
    const items = await listComplianceItems(db, await officer.ctx());
    expect(items).toHaveLength(COMPLIANCE_CATALOG.length);
    await listComplianceItems(db, await officer.ctx());
    const [n] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(complianceItems)
      .where(eq(complianceItems.organizationId, A.org.id));
    expect(n!.n).toBe(COMPLIANCE_CATALOG.length);
    const r = await getReadiness(db, await officer.ctx());
    expect(r.verdict).toBe(READINESS_NOT_APPROVED);
    expect(r.approvedForRealPhi).toBe(false);
    expect(r.checks.find((c) => c.key === "app_mode")!.ok).toBe(false); // DEVELOPMENT never allows PHI
  });

  it("dual control: the submitter cannot approve (app 403 + DENY audit, and a DB CHECK); a second officer can", async () => {
    const [item] = await db
      .select()
      .from(complianceItems)
      .where(and(eq(complianceItems.organizationId, A.org.id), eq(complianceItems.key, "baa.executed")));
    const s = await updateComplianceItem(db, await officer.ctx(), item!.id, {
      action: "SUBMIT_EVIDENCE",
      version: item!.version,
      evidenceRef: "Contracts system #SYN-123 (synthetic)",
    });
    await expectAppError(updateComplianceItem(db, await officer.ctx(), item!.id, { action: "APPROVE", version: s.version }), "FORBIDDEN");
    const [deny] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.resourceId, item!.id), eq(auditEvents.action, "compliance.approve"), eq(auditEvents.outcome, "DENY")));
    expect(deny).toBeTruthy();
    await expect(db.execute(sql`update compliance_items set status = 'APPROVED', approved_by = submitted_by, approved_at = now() where id = ${item!.id}`)).rejects.toThrow();
    const ok = await updateComplianceItem(db, await officer2.ctx(), item!.id, { action: "APPROVE", version: s.version, notes: "Reviewed (synthetic)" });
    expect(ok.status).toBe("APPROVED");
    await expectAppError(updateComplianceItem(db, await officer.ctx(), item!.id, { action: "UPDATE", version: ok.version, status: "IN_PROGRESS" }), "CONFLICT");
    const re = await updateComplianceItem(db, await officer.ctx(), item!.id, { action: "REOPEN", version: ok.version, notes: "Vendor changed" });
    expect(re).toMatchObject({ status: "IN_PROGRESS", approvedBy: null });
  });

  it("only compliance staff may change items; others are refused", async () => {
    const [item] = await db.select().from(complianceItems).where(eq(complianceItems.organizationId, A.org.id)).limit(1);
    await expectAppError(updateComplianceItem(db, await A.users.pm.ctx(), item!.id, { action: "UPDATE", version: item!.version, status: "IN_PROGRESS" }), "FORBIDDEN");
    await expectAppError(listComplianceItems(db, await A.users.rcmAnalyst.ctx()), "FORBIDDEN");
  });

  it("even with every item approved, synthetic mode and failing checks keep the verdict NOT APPROVED", async () => {
    for (const i of await db.select().from(complianceItems).where(eq(complianceItems.organizationId, A.org.id))) {
      if (i.status === "APPROVED") continue;
      const s = await updateComplianceItem(db, await officer.ctx(), i.id, { action: "SUBMIT_EVIDENCE", version: i.version, evidenceRef: `Evidence for ${i.key} (synthetic)` });
      await updateComplianceItem(db, await officer2.ctx(), i.id, { action: "APPROVE", version: s.version });
    }
    const r = await getReadiness(db, await officer.ctx());
    expect(r.counts.openCritical).toBe(0);
    expect(r.counts.checksFailing).toBeGreaterThan(0);
    expect(r.verdict).toBe(READINESS_NOT_APPROVED);
  });

  it("MFA is mandatory for privileged roles outside synthetic modes", async () => {
    expect(isPrivileged(await A.users.admin.ctx())).toBe(true);
    expect(isPrivileged(await A.users.scheduler.ctx())).toBe(false);
    const prev = process.env.APP_MODE;
    process.env.APP_MODE = "PILOT_APPROVED";
    expect(mfaRequiredForPrivileged()).toBe(true);
    process.env.APP_MODE = prev;
    expect(mfaRequiredForPrivileged()).toBe(process.env.REQUIRE_MFA_FOR_PRIVILEGED === "true");
  });

  it("drill results are append-only evidence", async () => {
    const d = await recordDrill(db, { organizationId: A.org.id, kind: "BACKUP_RESTORE", status: "PASS", startedAt: new Date(), summary: { test: true }, runBy: "test" });
    await expect(db.execute(sql`update ops_drills set status = 'FAIL' where id = ${d.id}`)).rejects.toThrow();
    await expect(db.delete(opsDrills).where(eq(opsDrills.id, d.id))).rejects.toThrow();
  });
});

describe("synthetic clinic-day rehearsal", () => {
  it("runs the whole scripted day and every safety assertion passes", async () => {
    const r = await runClinicDayRehearsal(db);
    const failed = r.steps.filter((s) => !s.ok);
    expect(failed).toEqual([]);
    expect(r.pass).toBe(true);
    expect(r.total).toBeGreaterThanOrEqual(9);
  }, 120_000);
});
