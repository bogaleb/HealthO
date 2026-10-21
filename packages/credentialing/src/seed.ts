import { and, eq } from "drizzle-orm";
import { createDb, isMain, loadRootEnv, type Db } from "@projectos/db";
import { departments, memberships, practitioners, roleGrants, roles, services, sites, specialties, users } from "@projectos/db/schema";
import { hashPassword } from "better-auth/crypto";
import { loadAuthContext } from "@projectos/auth";
import { createMemberDirect, findOrgBySlug } from "@projectos/core";
import { appMode, addDays, isSyntheticMode, todayIn } from "@projectos/shared";
import {
  approveRule,
  createAuthority,
  createCase,
  createEnrollment,
  createPayer,
  createPlan,
  createPractitioner,
  createRuleDraft,
  changeAuthorityStatus,
  submitAuthority,
  updateEnrollment,
  verifyAuthority,
  verifyEnrollment,
} from "./index";
import { runCredentialDeadlines } from "./deadlines";

/**
 * SYNTHETIC credentialing demo data. Every rule is labelled DEMO SYNTHETIC POLICY — NOT VERIFIED LAW
 * (isDemo = true). Practitioners are fictional ("Practitioner A…") and mirror specs/DEMO_POLICY_FIXTURES.md.
 */
export const CRED_USERS = {
  approver: { email: "morgan.reyes@riverbend.example", name: "Morgan Reyes (Demo)" },
  compliance: { email: "dana.brooks@riverbend.example", name: "Dana Brooks (Demo)" },
} as const;
const DEMO = "DEMO SYNTHETIC POLICY — NOT VERIFIED LAW. Fixture for automated tests/demonstration only.";

export async function seedCredentialing(db: Db, password: string, slug = "riverbend-demo") {
  if (!isSyntheticMode(appMode())) throw new Error(`Seeding synthetic data is not allowed in APP_MODE=${appMode()}`);
  const org = await findOrgBySlug(db, slug);
  if (!org) throw new Error("Run the core seed first (pnpm db:seed).");
  const o = org.id;
  const existing = await db.select({ id: practitioners.id }).from(practitioners).where(eq(practitioners.organizationId, o)).limit(1);
  if (existing.length) return { skipped: true as const };

  const roleId = async (key: string) =>
    (
      await db
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.organizationId, o), eq(roles.key, key)))
    )[0]!.id;
  const dept = async (code: string) =>
    (
      await db
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.organizationId, o), eq(departments.code, code)))
    )[0]?.id ?? null;
  const userId = async (email: string) => (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]?.id;
  const passwordHash = await hashPassword(password);

  // Credentialing approver + compliance officer (separate people → dual control is real)
  const approverId =
    (await userId(CRED_USERS.approver.email)) ??
    (
      await createMemberDirect(db, {
        organizationId: o,
        email: CRED_USERS.approver.email,
        displayName: CRED_USERS.approver.name,
        passwordHash,
        professionalRole: "Credentialing Manager",
        departmentId: await dept("CRED"),
        grants: [{ roleId: await roleId("credentialing_approver") }],
      })
    ).userId;
  const complianceId =
    (await userId(CRED_USERS.compliance.email)) ??
    (
      await createMemberDirect(db, {
        organizationId: o,
        email: CRED_USERS.compliance.email,
        displayName: CRED_USERS.compliance.name,
        passwordHash,
        professionalRole: "Compliance Officer",
        departmentId: await dept("ADMIN"),
        grants: [{ roleId: await roleId("compliance_officer") }],
      })
    ).userId;
  // Casey (credentialing specialist) works across all sites for credentialing.
  const caseyId = (await userId("casey.lin@riverbend.example"))!;
  const [caseyM] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.organizationId, o), eq(memberships.userId, caseyId)));
  const csRole = await roleId("credentialing_specialist");
  const hasOrgWide = await db
    .select()
    .from(roleGrants)
    .where(and(eq(roleGrants.membershipId, caseyM!.id), eq(roleGrants.roleId, csRole)));
  if (!hasOrgWide.some((g) => !g.siteId && !g.departmentId)) await db.insert(roleGrants).values({ organizationId: o, membershipId: caseyM!.id, roleId: csRole });

  const casey = (await loadAuthContext(db, caseyId, "seed"))!;
  const approver = (await loadAuthContext(db, approverId, "seed"))!;
  const compliance = (await loadAuthContext(db, complianceId, "seed"))!;
  const today = todayIn("America/New_York");
  const review = { sourceName: "Synthetic primary-source check (DEMO — not a real lookup)", verifiedOn: today, nextReviewOn: addDays(today, 365) };

  const siteRows = await db.select().from(sites).where(eq(sites.organizationId, o));
  const site = (code: string) => siteRows.find((s) => s.code === code)!.id;

  const [fm, bh, np] = await db
    .insert(specialties)
    .values([
      { organizationId: o, code: "FM", name: "Family medicine" },
      { organizationId: o, code: "BH", name: "Behavioral health" },
      { organizationId: o, code: "NURSE", name: "Nursing care" },
    ])
    .returning();
  const [pc, therapy, testing, nurseVisit] = await db
    .insert(services)
    .values([
      { organizationId: o, code: "PC-VISIT", name: "Primary care visit", category: "PRIMARY_CARE" },
      { organizationId: o, code: "BH-THERAPY", name: "Therapy follow-up", category: "BEHAVIORAL_HEALTH" },
      { organizationId: o, code: "PSY-EVAL", name: "Psychological evaluation", category: "PSYCHOLOGICAL_TESTING" },
      { organizationId: o, code: "RN-VISIT", name: "Nurse follow-up", category: "NURSING" },
    ])
    .returning();

  // ---- Approved DEMO rules (authored by Casey, approved by Dana → dual control satisfied) ----
  const rule = async (jurisdiction: string, profession: string, modality: string, basis: string[] = ["STATE_LICENSE"], homes: string[] = []) => {
    const d = await createRuleDraft(db, casey, {
      jurisdiction,
      profession,
      modality,
      authorizationBasis: basis,
      acceptedHomeStates: homes,
      effectiveFrom: "2026-01-01",
      nextReviewOn: addDays(today, 180),
      sourceSummary: DEMO,
      isDemo: true,
    });
    return approveRule(db, compliance, d.id, { reason: "Approved as DEMO fixture only — not a legal determination." });
  };
  for (const m of ["IN_PERSON", "VIDEO"]) {
    await rule("VA", "PHYSICIAN", m);
    await rule("MD", "PHYSICIAN", m);
    await rule("VA", "RN", m, ["STATE_LICENSE", "MULTISTATE_LICENSE"], ["VA"]);
    await rule("VA", "PSYCHOLOGIST", m);
    await rule("VA", "LCSW", m);
    await rule("MD", "LCSW", m);
    await rule("VA", "APRN", m);
  }
  await rule("MD", "RN", "VIDEO", ["STATE_LICENSE", "MULTISTATE_LICENSE"], ["VA"]);
  await rule("MD", "APRN", "VIDEO");
  await rule("MD", "PSYCHOLOGIST", "VIDEO", ["STATE_LICENSE", "APIT"], ["VA"]);
  // DC intentionally has NO approved rules (fixture C). One draft is waiting for compliance review:
  await createRuleDraft(db, casey, {
    jurisdiction: "DC",
    profession: "LCSW",
    modality: "VIDEO",
    authorizationBasis: ["STATE_LICENSE"],
    effectiveFrom: "2026-01-01",
    nextReviewOn: addDays(today, 180),
    sourceSummary: DEMO,
    isDemo: true,
  });

  // ---- Practitioners (fictional) ----
  const prac = async (displayName: string, profession: string, siteCodes: string[], physicalState: string, spec: string[], svc: string[]) =>
    createPractitioner(db, casey, {
      displayName,
      profession,
      physicalState,
      telehealthCapable: true,
      siteIds: siteCodes.map(site),
      specialtyIds: spec,
      serviceIds: svc,
      languages: ["English"],
    });
  const verified = async (practitionerId: string, a: Record<string, unknown>) => {
    const created = await createAuthority(db, casey, practitionerId, { effectiveOn: "2025-01-01", ...a });
    const sub = await submitAuthority(db, casey, created.id, { version: created.version });
    return verifyAuthority(db, approver, created.id, { version: sub.version, ...review });
  };
  const submitted = async (practitionerId: string, a: Record<string, unknown>) => {
    const created = await createAuthority(db, casey, practitionerId, { effectiveOn: "2025-01-01", ...a });
    return submitAuthority(db, casey, created.id, { version: created.version });
  };

  const A = await prac("Practitioner A — Dr. Alder (SYNTHETIC)", "PHYSICIAN", ["ALX"], "VA", [fm!.id], [pc!.id]);
  await verified(A.id, {
    authorityType: "STATE_LICENSE",
    profession: "PHYSICIAN",
    jurisdiction: "VA",
    licenseNumberLast4: "0A01",
    issuingAuthority: "Demo VA Board (synthetic)",
    expiresOn: "2027-03-31",
  });
  await createAuthority(db, casey, A.id, {
    authorityType: "COMPACT_MEMBERSHIP_CLAIM",
    profession: "PHYSICIAN",
    jurisdiction: "MD",
    effectiveOn: "2025-06-01",
    restrictions: "Provider states IMLC participation. Informational only — no MD license issued.",
  });

  const B = await prac("Practitioner B — Nurse Birch (SYNTHETIC)", "RN", ["SSP", "ALX"], "VA", [np!.id], [nurseVisit!.id]);
  await verified(B.id, { authorityType: "MULTISTATE_LICENSE", profession: "RN", jurisdiction: "VA", homeState: "VA", licenseNumberLast4: "0B01", expiresOn: "2027-06-30" });

  const B2 = await prac("Practitioner B2 — NP Cedar (SYNTHETIC)", "APRN", ["SSP"], "VA", [fm!.id], [pc!.id]);
  await verified(B2.id, { authorityType: "STATE_LICENSE", profession: "APRN", jurisdiction: "VA", licenseNumberLast4: "0B02", expiresOn: "2027-01-31" });
  await createAuthority(db, casey, B2.id, {
    authorityType: "COMPACT_MEMBERSHIP_CLAIM",
    profession: "APRN",
    jurisdiction: "MD",
    effectiveOn: "2025-01-01",
    restrictions: "Holds RN multistate privilege; does NOT extend to APRN practice.",
  });

  const C = await prac("Practitioner C — Dr. Dogwood, PhD (SYNTHETIC)", "PSYCHOLOGIST", ["NEDC"], "VA", [bh!.id], [therapy!.id, testing!.id]);
  await verified(C.id, { authorityType: "STATE_LICENSE", profession: "PSYCHOLOGIST", jurisdiction: "VA", licenseNumberLast4: "0C01", expiresOn: "2027-08-31" });
  const apit = await submitted(C.id, {
    authorityType: "APIT",
    profession: "PSYCHOLOGIST",
    jurisdiction: "VA",
    homeState: "VA",
    licenseNumberLast4: "0C02",
    expiresOn: "2027-08-31",
  });

  const D = await prac("Practitioner D — Elm, LCSW (SYNTHETIC)", "LCSW", ["ALX", "SSP"], "VA", [bh!.id], [therapy!.id]);
  await verified(D.id, { authorityType: "STATE_LICENSE", profession: "LCSW", jurisdiction: "VA", licenseNumberLast4: "0D01", expiresOn: "2028-02-29" });
  await verified(D.id, { authorityType: "STATE_LICENSE", profession: "LCSW", jurisdiction: "MD", licenseNumberLast4: "0D02", expiresOn: "2027-12-31" });

  const G = await prac("Practitioner G — Dr. Fir (SYNTHETIC)", "PHYSICIAN", ["SSP"], "MD", [fm!.id], [pc!.id]);
  await verified(G.id, { authorityType: "STATE_LICENSE", profession: "PHYSICIAN", jurisdiction: "VA", licenseNumberLast4: "0G01", expiresOn: addDays(today, 25) });
  const gmd = await verified(G.id, { authorityType: "STATE_LICENSE", profession: "PHYSICIAN", jurisdiction: "MD", licenseNumberLast4: "0G02", expiresOn: "2027-09-30" });
  await changeAuthorityStatus(db, approver, gmd.id, { version: gmd.version, status: "SUSPENDED", note: "Synthetic board action for demo (fixture G)." });

  // ---- Payers (fictional) ----
  const px = (await createPayer(db, casey, { code: "DEMOCOM", name: "Demo Commercial Health (SYNTHETIC)" }))!;
  const ppo = (await createPlan(db, casey, { payerId: px.id, code: "PPOY", name: "PPO Y", requiresEnrollment: true }))!;
  const pm = (await createPayer(db, casey, { code: "DEMOMCD", name: "Demo Medicaid MCO (SYNTHETIC)" }))!;
  const mcd = (await createPlan(db, casey, { payerId: pm.id, code: "MMC", name: "Medicaid Managed Care", requiresEnrollment: true }))!;
  const selfPayer = (await createPayer(db, casey, { code: "SELF", name: "Self-pay / sliding fee" }))!;
  await createPlan(db, casey, { payerId: selfPayer.id, code: "SLIDE", name: "Sliding fee (no enrollment)", requiresEnrollment: false });

  const enrollApproved = async (practitionerId: string, planId: string, siteCode: string, verify: boolean) => {
    const e = (await createEnrollment(db, casey, { practitionerId, payerPlanId: planId, siteId: site(siteCode), status: "SUBMITTED", submittedOn: addDays(today, -60) }))!;
    const ap = await updateEnrollment(db, casey, e.id, {
      version: e.version,
      status: "APPROVED",
      submittedOn: addDays(today, -60),
      approvedOn: addDays(today, -10),
      effectiveOn: addDays(today, -45),
    });
    if (verify) await verifyEnrollment(db, approver, e.id, { version: ap.version, sourceName: "Synthetic payer approval letter (DEMO)" });
  };
  // Fixture F: D approved for PPO Y at ALX only; SSP still pending.
  await enrollApproved(D.id, ppo.id, "ALX", true);
  const dSsp = (await createEnrollment(db, casey, { practitionerId: D.id, payerPlanId: ppo.id, siteId: site("SSP"), status: "SUBMITTED", submittedOn: addDays(today, -20) }))!;
  await enrollApproved(A.id, ppo.id, "ALX", false); // recorded approval awaiting verification
  await enrollApproved(A.id, mcd.id, "ALX", true);
  await enrollApproved(B.id, mcd.id, "SSP", true);

  // ---- Cases ----
  await createCase(db, casey, {
    practitionerId: C.id,
    caseType: "LICENSE_NEW_STATE",
    title: "Verify APIT for MD telepsychology",
    ownerUserId: caseyId,
    dueDate: addDays(today, 7),
    nextAction: "Approver to review submitted APIT evidence",
    authorityId: apit.id,
  });
  await createCase(db, casey, {
    practitionerId: D.id,
    caseType: "PAYER_ENROLLMENT",
    title: "PPO Y enrollment — Silver Spring",
    ownerUserId: caseyId,
    dueDate: addDays(today, 21),
    nextAction: "Follow up with payer on application status",
    enrollmentId: dSsp.id,
  });
  await createCase(db, casey, {
    practitionerId: A.id,
    caseType: "LICENSE_NEW_STATE",
    title: "Maryland license application",
    ownerUserId: caseyId,
    dueDate: addDays(today, 45),
    nextAction: "Submit MD application (IMLC claim is not a license)",
  });

  const deadlines = await runCredentialDeadlines(db, { organizationId: o });
  return { skipped: false as const, practitioners: 6, deadlines };
}

if (isMain(import.meta.url)) {
  loadRootEnv();
  const pw = process.env.DEMO_PASSWORD;
  if (!pw || pw.length < 12) {
    console.error("DEMO_PASSWORD must be set (>= 12 chars) in .env.");
    process.exit(1);
  }
  const { sql, db } = createDb(undefined, 2);
  seedCredentialing(db, pw)
    .then((r) => console.log(JSON.stringify({ level: "info", msg: r.skipped ? "credentialing demo data already seeded — skipping" : "synthetic credentialing data seeded", ...r })))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}
