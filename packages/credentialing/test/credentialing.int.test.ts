import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { auditEvents, credentialDeadlineNotices, licensePolicyRules, services, tasks } from "@projectos/db/schema";
import { makeOrg, testDb, expectAppError, type Fixture } from "../../core/test/helpers";
import {
  approveRule,
  changeAuthorityStatus,
  createAuthority,
  createCase,
  createEnrollment,
  createPayer,
  createPlan,
  createPractitioner,
  createRuleDraft,
  getPractitionerDetail,
  getReadinessMatrix,
  linkCaseTask,
  listPractitioners,
  rejectAuthority,
  retireRule,
  runCredentialDeadlines,
  submitAuthority,
  updateCase,
  updateEnrollment,
  verifyAuthority,
  verifyEnrollment,
} from "../src";
import { createProject } from "@projectos/core";
import { addDays, todayIn } from "@projectos/shared";

const { db, end } = testDb();
let A: Fixture;
let B: Fixture;
let spec: Awaited<ReturnType<Fixture["user"]>>;
let approver: Awaited<ReturnType<Fixture["user"]>>;
let compliance: Awaited<ReturnType<Fixture["user"]>>;
const today = todayIn("America/New_York");
const review = { sourceName: "Synthetic primary-source check (DEMO)", verifiedOn: today, nextReviewOn: addDays(today, 365) };

beforeAll(async () => {
  A = await makeOrg(db, "CR");
  B = await makeOrg(db, "CX");
  spec = await A.user("credspec", [{ roleId: A.roleIds.credentialing_specialist! }]);
  approver = await A.user("credappr", [{ roleId: A.roleIds.credentialing_approver! }]);
  compliance = await A.user("compliance", [{ roleId: A.roleIds.compliance_officer! }]);
});
afterAll(async () => end());

async function verifiedLicense(practitionerId: string, o: Record<string, unknown> = {}) {
  const s = await spec.ctx();
  const a = await createAuthority(db, s, practitionerId, { authorityType: "STATE_LICENSE", profession: "PHYSICIAN", jurisdiction: "VA", licenseNumberLast4: "1234", effectiveOn: "2025-01-01", expiresOn: "2027-03-31", ...o });
  const sub = await submitAuthority(db, s, a.id, { version: a.version });
  return verifyAuthority(db, await approver.ctx(), a.id, { version: sub.version, ...review });
}

async function approvedRule(o: Record<string, unknown> = {}) {
  const draft = await createRuleDraft(db, await spec.ctx(), {
    jurisdiction: "VA",
    profession: "PHYSICIAN",
    modality: "VIDEO",
    authorizationBasis: ["STATE_LICENSE"],
    effectiveFrom: "2026-01-01",
    nextReviewOn: addDays(today, 180),
    sourceSummary: "DEMO SYNTHETIC POLICY — NOT VERIFIED LAW",
    ...o,
  });
  return approveRule(db, await compliance.ctx(), draft.id, { reason: "Test fixture approval" });
}

describe("evidence lifecycle + dual control (CRED-01)", () => {
  it("draft → submitted → verified with append-only history; submitter cannot self-verify", async () => {
    const s = await spec.ctx();
    const p = await createPractitioner(db, s, { displayName: "Practitioner A (SYNTHETIC)", profession: "PHYSICIAN", physicalState: "VA", siteIds: [A.sites.s1.id] });
    const a = await createAuthority(db, s, p.id, { authorityType: "STATE_LICENSE", profession: "PHYSICIAN", jurisdiction: "VA", effectiveOn: "2025-01-01", expiresOn: "2027-03-31" });
    expect(a.status).toBe("DRAFT");
    const sub = await submitAuthority(db, s, a.id, { version: a.version });
    // specialist lacks credentialing.approve
    await expectAppError(verifyAuthority(db, s, a.id, { version: sub.version, ...review }), "FORBIDDEN");
    // admin has approve, but dual control blocks the person who submitted... admin did not submit → allowed path tested below.
    const adminSelf = await A.users.admin.ctx();
    const mine = await createAuthority(db, adminSelf, p.id, { authorityType: "STATE_LICENSE", profession: "PHYSICIAN", jurisdiction: "MD", effectiveOn: "2025-01-01" });
    const mineSub = await submitAuthority(db, adminSelf, mine.id, { version: mine.version });
    await expectAppError(verifyAuthority(db, adminSelf, mine.id, { version: mineSub.version, ...review }), "FORBIDDEN");
    const denied = await db.select().from(auditEvents).where(and(eq(auditEvents.resourceId, mine.id), eq(auditEvents.outcome, "DENY")));
    expect(denied.length).toBe(1);
    const v = await verifyAuthority(db, await approver.ctx(), a.id, { version: sub.version, ...review });
    expect(v.status).toBe("VERIFIED");
    expect(v.verifiedBy).toBe(approver.userId);
    // history is append-only
    const tamper = await db.execute(sql`update authority_verifications set note = 'x'`).then(() => "ok", (e: Error & { cause?: Error }) => `${e.message} ${e.cause?.message}`);
    expect(tamper).toMatch(/append-only/);
  });

  it("rejects profession mismatch and verifying a compact claim; reject → resubmit works", async () => {
    const s = await spec.ctx();
    const p = await createPractitioner(db, s, { displayName: "Practitioner B (SYNTHETIC)", profession: "RN", siteIds: [A.sites.s1.id] });
    await expectAppError(createAuthority(db, s, p.id, { authorityType: "STATE_LICENSE", profession: "APRN", jurisdiction: "VA", effectiveOn: "2025-01-01" }), "VALIDATION_FAILED");
    const claim = await createAuthority(db, s, p.id, { authorityType: "COMPACT_MEMBERSHIP_CLAIM", profession: "RN", jurisdiction: "MD", effectiveOn: "2025-01-01" });
    const cs = await submitAuthority(db, s, claim.id, { version: claim.version });
    await expectAppError(verifyAuthority(db, await approver.ctx(), claim.id, { version: cs.version, ...review }), "VALIDATION_FAILED");
    const a = await createAuthority(db, s, p.id, { authorityType: "STATE_LICENSE", profession: "RN", jurisdiction: "VA", effectiveOn: "2025-01-01" });
    const sub = await submitAuthority(db, s, a.id, { version: a.version });
    const rej = await rejectAuthority(db, await approver.ctx(), a.id, { version: sub.version, note: "Synthetic: number mismatch" });
    expect(rej.status).toBe("REJECTED");
    const re = await submitAuthority(db, s, a.id, { version: rej.version });
    expect(re.status).toBe("SUBMITTED");
  });
});

describe("policy rules (SEC-02, immutability, no blanket compacts)", () => {
  it("only policy.publish can approve; author cannot approve own draft; approved rules immutable; supersede by version", async () => {
    const draft = await createRuleDraft(db, await spec.ctx(), { jurisdiction: "MD", profession: "PHYSICIAN", modality: "VIDEO", authorizationBasis: ["STATE_LICENSE"], effectiveFrom: "2026-01-01", nextReviewOn: addDays(today, 90), sourceSummary: "DEMO" });
    await expectAppError(approveRule(db, await spec.ctx(), draft.id, { reason: "x" }), "FORBIDDEN"); // SEC-02
    await expectAppError(approveRule(db, await A.users.scheduler.ctx(), draft.id, { reason: "x" }), "FORBIDDEN");
    const own = await createRuleDraft(db, await compliance.ctx(), { jurisdiction: "DC", profession: "PHYSICIAN", modality: "VIDEO", authorizationBasis: ["STATE_LICENSE"], effectiveFrom: "2026-01-01", nextReviewOn: addDays(today, 90), sourceSummary: "DEMO" });
    await expectAppError(approveRule(db, await compliance.ctx(), own.id, { reason: "x" }), "FORBIDDEN"); // dual control
    const v1 = await approveRule(db, await compliance.ctx(), draft.id, { reason: "Fixture" });
    expect(v1.status).toBe("APPROVED");
    const tamper = await db.execute(sql`update license_policy_rules set jurisdiction = 'VA' where id = ${v1.id}`).then(() => "ok", (e: Error & { cause?: Error }) => `${e.cause?.message}`);
    expect(tamper).toMatch(/immutable/);
    const draft2 = await createRuleDraft(db, await spec.ctx(), { jurisdiction: "MD", profession: "PHYSICIAN", modality: "VIDEO", authorizationBasis: ["STATE_LICENSE"], effectiveFrom: "2026-06-01", nextReviewOn: addDays(today, 90), sourceSummary: "DEMO v2" });
    expect(draft2.ruleVersion).toBe("2");
    const v2 = await approveRule(db, await compliance.ctx(), draft2.id, { reason: "Fixture v2" });
    expect(v2.supersedesId).toBe(v1.id);
    const [old] = await db.select().from(licensePolicyRules).where(eq(licensePolicyRules.id, v1.id));
    expect(old!.status).toBe("RETIRED");
    await retireRule(db, await compliance.ctx(), v2.id, { reason: "cleanup" });
  });

  it("multistate/APIT basis requires explicit home states; compact claim can never be a basis (DB check)", async () => {
    await expectAppError(
      createRuleDraft(db, await spec.ctx(), { jurisdiction: "MD", profession: "RN", modality: "VIDEO", authorizationBasis: ["MULTISTATE_LICENSE"], effectiveFrom: "2026-01-01", nextReviewOn: addDays(today, 90), sourceSummary: "DEMO" }),
      "VALIDATION_FAILED",
    );
    await expectAppError(
      createRuleDraft(db, await spec.ctx(), { jurisdiction: "MD", profession: "RN", modality: "VIDEO", authorizationBasis: ["COMPACT_MEMBERSHIP_CLAIM"], effectiveFrom: "2026-01-01", nextReviewOn: addDays(today, 90), sourceSummary: "DEMO" }),
      "VALIDATION_FAILED",
    );
    const r = await db
      .execute(sql`insert into license_policy_rules (organization_id, rule_key, rule_version, jurisdiction, profession, modality, authorization_basis, effective_from, next_review_on, source_summary, created_by)
        values (${A.org.id}, 'x', '1', 'MD', 'RN', 'VIDEO', array['COMPACT_MEMBERSHIP_CLAIM'], '2026-01-01', '2027-01-01', 'x', ${A.users.admin.userId})`)
      .then(() => "inserted", () => "rejected");
    expect(r).toBe("rejected");
  });
});

describe("Phase 3 exit: readiness changes when verification / expiry / payer changes", () => {
  it("license readiness follows evidence; payer readiness is independent and site-specific (CRED-02, F)", async () => {
    await approvedRule({ jurisdiction: "VA", profession: "PSYCHOLOGIST" });
    const s = await spec.ctx();
    const p = await createPractitioner(db, s, { displayName: "Practitioner D (SYNTHETIC)", profession: "PSYCHOLOGIST", physicalState: "VA", siteIds: [A.sites.s1.id, A.sites.s2.id] });
    const cell = async () => (await getReadinessMatrix(db, s, { modality: "VIDEO", profession: "PSYCHOLOGIST" })).license.find((r) => r.practitioner.id === p.id)!.cells.VA!;
    expect((await cell()).decision).toBe("REVIEW"); // no evidence yet
    const a = await createAuthority(db, s, p.id, { authorityType: "STATE_LICENSE", profession: "PSYCHOLOGIST", jurisdiction: "VA", effectiveOn: "2025-01-01", expiresOn: addDays(today, 200) });
    const sub = await submitAuthority(db, s, a.id, { version: a.version });
    expect((await cell()).reasons.map((r) => r.code)).toContain("AUTHORITY_NOT_VERIFIED");
    const v = await verifyAuthority(db, await approver.ctx(), a.id, { version: sub.version, ...review });
    const ok = await cell();
    expect(ok.decision).toBe("ALLOW");
    expect(ok.evidenceIds).toEqual([a.id]);
    await changeAuthorityStatus(db, await approver.ctx(), a.id, { version: v.version, status: "SUSPENDED", note: "Synthetic board action" });
    expect((await cell()).decision).toBe("BLOCK");

    // Payer: independent of license
    const payer = (await createPayer(db, s, { code: "DEMOX", name: "Demo Payer X" }))!;
    const plan = (await createPlan(db, s, { payerId: payer.id, code: "PPOY", name: "PPO Y" }))!;
    const e1 = (await createEnrollment(db, s, { practitionerId: p.id, payerPlanId: plan.id, siteId: A.sites.s1.id, status: "SUBMITTED", submittedOn: today }))!;
    await createEnrollment(db, s, { practitionerId: p.id, payerPlanId: plan.id, siteId: A.sites.s2.id, status: "SUBMITTED", submittedOn: today });
    const payerCell = async (siteId: string) => (await getReadinessMatrix(db, s, { modality: "VIDEO", profession: "PSYCHOLOGIST" })).payer.find((r) => r.practitioner.id === p.id && r.site.id === siteId)!.plans.find((x) => x.planId === plan.id)!.result;
    expect((await payerCell(A.sites.s1.id)).status).toBe("NOT_READY");
    await expectAppError(updateEnrollment(db, s, e1.id, { version: e1.version, status: "APPROVED" }), "VALIDATION_FAILED"); // dates required
    const appr = await updateEnrollment(db, s, e1.id, { version: e1.version, status: "APPROVED", approvedOn: today, effectiveOn: addDays(today, -30) });
    expect((await payerCell(A.sites.s1.id)).status).toBe("UNKNOWN"); // recorded but unverified
    await expectAppError(verifyEnrollment(db, await A.users.admin.ctx(), e1.id, { version: appr.version, sourceName: "x" }).then(() => verifyEnrollment(db, s, e1.id, { version: appr.version + 1, sourceName: "x" })), "FORBIDDEN");
    expect((await payerCell(A.sites.s1.id)).status).toBe("READY");
    expect((await payerCell(A.sites.s2.id)).status).toBe("NOT_READY");
  });

  it("dual control on enrollment verification: the person who recorded approval cannot verify", async () => {
    const admin = await A.users.admin.ctx();
    const p = await createPractitioner(db, admin, { displayName: "Practitioner E (SYNTHETIC)", profession: "LCSW", siteIds: [A.sites.s1.id] });
    const payer = (await createPayer(db, admin, { code: "DEMOZ", name: "Demo Payer Z" }))!;
    const plan = (await createPlan(db, admin, { payerId: payer.id, code: "HMO", name: "HMO" }))!;
    const e = (await createEnrollment(db, admin, { practitionerId: p.id, payerPlanId: plan.id, siteId: A.sites.s1.id }))!;
    const ap = await updateEnrollment(db, admin, e.id, { version: e.version, status: "APPROVED", approvedOn: today, effectiveOn: today });
    await expectAppError(verifyEnrollment(db, admin, e.id, { version: ap.version, sourceName: "x" }), "FORBIDDEN");
    const ok = await verifyEnrollment(db, await approver.ctx(), e.id, { version: ap.version, sourceName: "Synthetic payer letter" });
    expect(ok.verifiedBy).toBe(approver.userId);
    await expectAppError(createEnrollment(db, admin, { practitionerId: p.id, payerPlanId: plan.id, siteId: A.sites.s2.id }), "VALIDATION_FAILED"); // not affiliated
  });
});

describe("deadline job (OPS-01) and expiry", () => {
  it("creates one renewal task for the tightest threshold; reruns and concurrent runs never duplicate; past-due becomes EXPIRED", async () => {
    const p = await createPractitioner(db, await spec.ctx(), { displayName: "Practitioner G (SYNTHETIC)", profession: "PHYSICIAN", siteIds: [A.sites.s1.id] });
    const soon = await verifiedLicense(p.id, { expiresOn: addDays(today, 25) });
    const later = await verifiedLicense(p.id, { jurisdiction: "MD", expiresOn: addDays(today, 75) });
    const past = await verifiedLicense(p.id, { jurisdiction: "DC", expiresOn: addDays(today, -1), effectiveOn: "2024-01-01" });
    const results = await Promise.all([runCredentialDeadlines(db, { organizationId: A.org.id }), runCredentialDeadlines(db, { organizationId: A.org.id })]);
    expect(results.reduce((n, r) => n + r.tasksCreated, 0)).toBe(2);
    expect(results.reduce((n, r) => n + r.expired, 0)).toBe(1);
    const again = await runCredentialDeadlines(db, { organizationId: A.org.id });
    expect(again).toEqual({ expired: 0, tasksCreated: 0 });
    const notices = await db.select().from(credentialDeadlineNotices).where(eq(credentialDeadlineNotices.organizationId, A.org.id));
    expect(notices.filter((n) => n.authorityId === soon.id).map((n) => n.thresholdDays).sort()).toEqual(["30", "60", "90"]);
    expect(notices.filter((n) => n.authorityId === soon.id && n.taskId).length).toBe(1);
    expect(notices.filter((n) => n.authorityId === later.id).map((n) => n.thresholdDays).sort()).toEqual(["90"]);
    const renewTasks = await db.select().from(tasks).where(and(eq(tasks.organizationId, A.org.id), sql`'renewal' = any(${tasks.labels})`));
    expect(renewTasks).toHaveLength(2);
    const d = await getPractitionerDetail(db, await spec.ctx(), p.id);
    expect(d.authorities.find((a) => a.id === past.id)!.status).toBe("EXPIRED");
    // 35 days later the MD license crosses 60 → exactly one new task
    const later35 = new Date(Date.now() + 35 * 86_400_000);
    const r2 = await runCredentialDeadlines(db, { organizationId: A.org.id, now: later35 });
    expect(r2.tasksCreated).toBe(1);
  });
});

describe("cases and linked tasks", () => {
  it("case completion moves the linked project task to Done", async () => {
    const admin = await A.users.admin.ctx();
    const p = await createPractitioner(db, admin, { displayName: "Practitioner H (SYNTHETIC)", profession: "RN", siteIds: [A.sites.s1.id] });
    const proj = (await createProject(db, admin, { key: "CREDW", name: "Credentialing work" }))!;
    const c = await createCase(db, admin, { practitionerId: p.id, caseType: "LICENSE_NEW_STATE", title: "Verify MD authority", dueDate: addDays(today, 10) });
    const linked = await linkCaseTask(db, admin, c.id, { projectId: proj.id });
    await expectAppError(linkCaseTask(db, admin, c.id, { projectId: proj.id }), "CONFLICT");
    const done = await updateCase(db, admin, c.id, { version: linked.case.version, status: "COMPLETED" });
    expect(done.taskSync).toBe("DONE");
    const [t] = await db.select().from(tasks).where(eq(tasks.id, linked.task.id));
    expect(t!.status).toBe("DONE");
  });
});

describe("directory aggregates (regression: correlated subqueries must use qualified outer columns)", () => {
  it("lists sites, verified states and alert counts per provider", async () => {
    const s = await spec.ctx();
    const p = await createPractitioner(db, s, { displayName: "Practitioner AGG (SYNTHETIC)", profession: "PHYSICIAN", siteIds: [A.sites.s1.id, A.sites.s2.id] });
    await verifiedLicense(p.id, { expiresOn: addDays(today, 40) });
    const pending = await createAuthority(db, s, p.id, { authorityType: "STATE_LICENSE", profession: "PHYSICIAN", jurisdiction: "MD", effectiveOn: "2025-01-01" });
    await submitAuthority(db, s, pending.id, { version: pending.version });
    const row = (await listPractitioners(db, s, { q: "AGG" }))[0]!;
    expect(row.siteCodes).toEqual(["S1", "S2"]);
    expect(row.verifiedStates).toEqual(["VA"]);
    expect(row.expiringSoon).toBe(1);
    expect(row.pendingReview).toBe(1);
    expect((await listPractitioners(db, s, { state: "MD" })).map((x) => x.id)).toContain(p.id);
    expect((await listPractitioners(db, s, { siteId: A.sites.s2.id })).map((x) => x.id)).toContain(p.id);
  });
});

describe("authorization and isolation", () => {
  it("scheduler/RCM cannot read credentialing; other org sees nothing (404); site-scoped specialist sees only their site", async () => {
    const admin = await A.users.admin.ctx();
    const p = await createPractitioner(db, admin, { displayName: "Practitioner S2 (SYNTHETIC)", profession: "LPC", siteIds: [A.sites.s2.id] });
    await expectAppError(listPractitioners(db, await A.users.rcmAnalyst.ctx(), {}), "FORBIDDEN");
    await expectAppError(getPractitionerDetail(db, await B.users.admin.ctx(), p.id), "NOT_FOUND");
    expect((await listPractitioners(db, await B.users.admin.ctx(), {})).length).toBe(0);
    const siteSpec = await A.user("sitespec", [{ roleId: A.roleIds.credentialing_specialist!, siteId: A.sites.s1.id }]);
    const sctx = await siteSpec.ctx();
    expect((await listPractitioners(db, sctx, {})).some((x) => x.id === p.id)).toBe(false);
    await expectAppError(getPractitionerDetail(db, sctx, p.id), "NOT_FOUND");
    await expectAppError(createPractitioner(db, sctx, { displayName: "x", profession: "RN", siteIds: [A.sites.s2.id] }), "FORBIDDEN");
    const forged = await createPractitioner(db, admin, { displayName: "Forged org (SYNTHETIC)", profession: "RN", organizationId: B.org.id } as never);
    expect(forged.organizationId).toBe(A.org.id);
    await expectAppError(createPractitioner(db, admin, { displayName: "x", profession: "RN", serviceIds: [(await db.insert(services).values({ organizationId: B.org.id, code: "X", name: "x", category: "NURSING" }).returning())[0]!.id] }), "VALIDATION_FAILED");
  });
});
