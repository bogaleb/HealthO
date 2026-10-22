import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { createDb, isMain, loadRootEnv, type Db } from "@projectos/db";
import { credentialingCases, departments, memberships, payerPlans, payers, practitioners, projects, rcmQueues, roles, sites, users } from "@projectos/db/schema";
import { loadAuthContext, type AuthContext } from "@projectos/auth";
import { createMemberDirect, findOrgBySlug } from "@projectos/core";
import { dispatchOutbox } from "@projectos/notifications";
import { addDays, appMode, isSyntheticMode, todayIn, type RcmCaseType, type TaskPriority } from "@projectos/shared";
import { createQueue } from "./queues";
import { addCaseAction, createCase, escalateCase, linkCaseTask, updateCase } from "./cases";
import { scanRcmDue } from "./scan";

/** SYNTHETIC revenue-cycle demo data: four queues, ~26 cases with fictional SYN- claim references, no patients. */
export const RCM_USERS = {
  supervisor: { email: "taylor.nguyen@riverbend.example", name: "Taylor Nguyen (Demo)" },
  analyst2: { email: "drew.patel@riverbend.example", name: "Drew Patel (Demo)" },
} as const;

async function userCtx(db: Db, orgId: string, email: string): Promise<AuthContext> {
  const [m] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, orgId), eq(users.email, email)));
  return (await loadAuthContext(db, m!.userId, "seed"))!;
}

export async function seedRcm(db: Db, password: string, slug = "riverbend-demo", now = new Date()) {
  if (!isSyntheticMode(appMode())) throw new Error("RCM demo seed runs only in synthetic modes.");
  const org = await findOrgBySlug(db, slug);
  if (!org) throw new Error("Run the core seed first.");
  const o = org.id;
  const [already] = await db.select({ id: rcmQueues.id }).from(rcmQueues).where(eq(rcmQueues.organizationId, o)).limit(1);
  if (already) return { skipped: true as const };

  const [rcmDept] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.organizationId, o), eq(departments.code, "RCM")));
  const roleId = async (key: string) =>
    (
      await db
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.organizationId, o), eq(roles.key, key)))
    )[0]!.id;
  const passwordHash = await hashPassword(password);
  for (const [k, u] of Object.entries(RCM_USERS)) {
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, u.email));
    if (exists) continue;
    await createMemberDirect(db, {
      organizationId: o,
      email: u.email,
      displayName: u.name,
      passwordHash,
      professionalRole: k === "supervisor" ? "Revenue Cycle Supervisor" : "Billing Follow-up Analyst",
      departmentId: rcmDept!.id,
      grants: [{ roleId: await roleId(k === "supervisor" ? "rcm_supervisor" : "rcm_analyst"), departmentId: rcmDept!.id }],
    });
  }
  const sup = await userCtx(db, o, RCM_USERS.supervisor.email);
  const drew = await userCtx(db, o, RCM_USERS.analyst2.email);
  const riley = await userCtx(db, o, "riley.shah@riverbend.example");
  const owners: Record<string, AuthContext | null> = { R: riley, D: drew, S: sup, _: null };

  const q = async (name: string, category: string, followUpDays: number, description: string) =>
    (await createQueue(db, sup, { name, category, departmentId: rcmDept!.id, leadUserId: sup.userId, followUpDays, description }))!;
  const denial = await q(
    "Denial initiative — CO-16 missing information",
    "DENIAL_INITIATIVE",
    7,
    "Initiative queue: work down CO-16 denials and fix the front-end cause. SYNTHETIC.",
  );
  const aging = await q("Aging A/R follow-up (60+ days)", "AGING_FOLLOW_UP", 14, "No-response and underpaid claims past 60 days. SYNTHETIC.");
  const cred = await q(
    "Credentialing-linked payer issues",
    "CREDENTIALING_PAYER",
    10,
    "Claims held or denied because a provider's enrollment is not complete. Linked to credentialing cases, not copied. SYNTHETIC.",
  );
  const quality = await q("Billing quality review", "BILLING_QUALITY", 5, "Coding/documentation checks and corrected claims before resubmission. SYNTHETIC.");

  const payerRows = await db.select().from(payers).where(eq(payers.organizationId, o));
  const planRows = await db.select().from(payerPlans).where(eq(payerPlans.organizationId, o));
  const payer = (code: string) => payerRows.find((p) => p.code === code)!.id;
  const plan = (code: string) => planRows.find((p) => p.code === code)!.id;
  const siteRows = await db.select().from(sites).where(eq(sites.organizationId, o));
  const site = (code: string) => siteRows.find((s) => s.code === code)!.id;
  const [credCase] = await db
    .select({ id: credentialingCases.id, practitionerId: credentialingCases.practitionerId })
    .from(credentialingCases)
    .where(and(eq(credentialingCases.organizationId, o), eq(credentialingCases.caseType, "PAYER_ENROLLMENT")));
  const [pracD] = await db
    .select({ id: practitioners.id })
    .from(practitioners)
    .where(and(eq(practitioners.organizationId, o), eq(practitioners.id, credCase?.practitionerId ?? "00000000-0000-0000-0000-000000000000")));

  const today = todayIn("America/New_York", now);
  const at = (daysAgo: number, hour = 10) => new Date(Date.parse(`${addDays(today, -daysAgo)}T${String(hour + 4).padStart(2, "0")}:00:00Z`));

  type Spec = {
    queue: { id: string };
    type: RcmCaseType;
    payer: string;
    plan?: string;
    site: string;
    age: number;
    amount: number;
    owner: keyof typeof owners;
    priority: TaskPriority;
    next: string;
    due: number;
    denial?: string;
    follow?: [number, "PAYER_CALL" | "PORTAL_CHECK" | "APPEAL_SUBMITTED" | "NOTE" | "CORRECTED_CLAIM_SUBMITTED" | "RECORDS_SENT", string][];
    status?: "WAITING_PAYER" | "RESOLVED" | "CLOSED_NO_ACTION" | "ESCALATED";
    credLink?: boolean;
  };
  const specs: Spec[] = [
    // Denial initiative (CO-16)
    {
      queue: denial,
      type: "DENIAL",
      payer: "DEMOCOM",
      plan: "PPOY",
      site: "ALX",
      age: 34,
      amount: 18_500,
      owner: "R",
      priority: "HIGH",
      denial: "CO-16",
      next: "Add missing referring provider and resubmit",
      due: -2,
      follow: [[6, "PORTAL_CHECK", "Denial confirmed in portal: CO-16 missing info (synthetic)."]],
    },
    {
      queue: denial,
      type: "DENIAL",
      payer: "DEMOCOM",
      plan: "PPOY",
      site: "ALX",
      age: 41,
      amount: 22_000,
      owner: "R",
      priority: "MEDIUM",
      denial: "CO-16",
      next: "Request corrected demographics from front desk",
      due: 0,
      follow: [[3, "NOTE", "Front-desk intake missed secondary info (synthetic)."]],
    },
    {
      queue: denial,
      type: "DENIAL",
      payer: "DEMOMCD",
      plan: "MMC",
      site: "SSP",
      age: 27,
      amount: 9_400,
      owner: "D",
      priority: "MEDIUM",
      denial: "CO-16",
      next: "Resubmit with authorization number",
      due: 1,
    },
    {
      queue: denial,
      type: "DENIAL",
      payer: "DEMOMCD",
      plan: "MMC",
      site: "SSP",
      age: 52,
      amount: 31_200,
      owner: "D",
      priority: "HIGH",
      denial: "CO-16",
      next: "Appeal with records",
      due: 4,
      follow: [
        [10, "PAYER_CALL", "Rep advised appeal with notes (synthetic)."],
        [2, "RECORDS_SENT", "Records packet sent via portal (synthetic)."],
      ],
      status: "WAITING_PAYER",
    },
    {
      queue: denial,
      type: "DENIAL",
      payer: "DEMOCOM",
      plan: "PPOY",
      site: "NEDC",
      age: 19,
      amount: 14_250,
      owner: "_",
      priority: "MEDIUM",
      denial: "CO-16",
      next: "Triage denial",
      due: 3,
    },
    {
      queue: denial,
      type: "DENIAL",
      payer: "DEMOCOM",
      plan: "PPOY",
      site: "NEDC",
      age: 22,
      amount: 12_000,
      owner: "_",
      priority: "LOW",
      denial: "CO-16",
      next: "Triage denial",
      due: -1,
    },
    {
      queue: denial,
      type: "DENIAL",
      payer: "DEMOCOM",
      plan: "PPOY",
      site: "ALX",
      age: 48,
      amount: 16_800,
      owner: "R",
      priority: "MEDIUM",
      denial: "CO-16",
      next: "—",
      due: 5,
      follow: [[12, "CORRECTED_CLAIM_SUBMITTED", "Corrected claim accepted (synthetic)."]],
      status: "RESOLVED",
    },
    {
      queue: denial,
      type: "DENIAL",
      payer: "DEMOMCD",
      plan: "MMC",
      site: "SSP",
      age: 39,
      amount: 7_900,
      owner: "D",
      priority: "LOW",
      denial: "CO-16",
      next: "—",
      due: 5,
      status: "RESOLVED",
    },
    // Aging follow-up
    {
      queue: aging,
      type: "NO_RESPONSE",
      payer: "DEMOCOM",
      plan: "PPOY",
      site: "ALX",
      age: 96,
      amount: 42_000,
      owner: "R",
      priority: "URGENT",
      next: "Call payer — no response after 2 submissions",
      due: -5,
      follow: [
        [30, "PORTAL_CHECK", "No claim on file (synthetic)."],
        [15, "PAYER_CALL", "Payer requested resubmission (synthetic)."],
      ],
    },
    {
      queue: aging,
      type: "NO_RESPONSE",
      payer: "DEMOMCD",
      plan: "MMC",
      site: "SSP",
      age: 128,
      amount: 26_400,
      owner: "D",
      priority: "HIGH",
      next: "Escalate to payer provider rep",
      due: -9,
      follow: [[40, "PAYER_CALL", "Pending review (synthetic)."]],
      status: "ESCALATED",
    },
    {
      queue: aging,
      type: "UNDERPAYMENT",
      payer: "DEMOCOM",
      plan: "PPOY",
      site: "ALX",
      age: 74,
      amount: 8_300,
      owner: "R",
      priority: "MEDIUM",
      next: "Compare to fee schedule and dispute",
      due: 2,
    },
    {
      queue: aging,
      type: "NO_RESPONSE",
      payer: "DEMOCOM",
      plan: "PPOY",
      site: "NEDC",
      age: 66,
      amount: 19_900,
      owner: "_",
      priority: "MEDIUM",
      next: "Check claim status in portal",
      due: 0,
    },
    {
      queue: aging,
      type: "NO_RESPONSE",
      payer: "DEMOMCD",
      plan: "MMC",
      site: "SSP",
      age: 105,
      amount: 33_100,
      owner: "_",
      priority: "HIGH",
      next: "Check claim status in portal",
      due: -3,
    },
    {
      queue: aging,
      type: "UNDERPAYMENT",
      payer: "DEMOMCD",
      plan: "MMC",
      site: "ALX",
      age: 88,
      amount: 5_600,
      owner: "D",
      priority: "LOW",
      next: "Request reprocessing",
      due: 9,
      status: "WAITING_PAYER",
      follow: [[5, "PAYER_CALL", "Reprocessing ticket opened (synthetic)."]],
    },
    {
      queue: aging,
      type: "NO_RESPONSE",
      payer: "DEMOCOM",
      plan: "PPOY",
      site: "ALX",
      age: 142,
      amount: 12_700,
      owner: "R",
      priority: "HIGH",
      next: "Final appeal before timely-filing limit",
      due: 1,
      follow: [[20, "APPEAL_SUBMITTED", "First-level appeal submitted (synthetic)."]],
    },
    {
      queue: aging,
      type: "NO_RESPONSE",
      payer: "DEMOCOM",
      plan: "PPOY",
      site: "SSP",
      age: 81,
      amount: 9_900,
      owner: "R",
      priority: "MEDIUM",
      next: "—",
      due: 5,
      status: "RESOLVED",
      follow: [[8, "PAYER_CALL", "Paid in full on reprocess (synthetic)."]],
    },
    { queue: aging, type: "NO_RESPONSE", payer: "SELF", site: "ALX", age: 95, amount: 2_500, owner: "D", priority: "LOW", next: "—", due: 5, status: "CLOSED_NO_ACTION" },
    // Credentialing-linked payer issues (linked to the PPO Y enrollment credentialing case)
    {
      queue: cred,
      type: "ENROLLMENT_BLOCKER",
      payer: "DEMOCOM",
      plan: "PPOY",
      site: "SSP",
      age: 24,
      amount: 21_000,
      owner: "R",
      priority: "HIGH",
      next: "Hold claims until enrollment approved; check credentialing case",
      due: 3,
      credLink: true,
    },
    {
      queue: cred,
      type: "ENROLLMENT_BLOCKER",
      payer: "DEMOCOM",
      plan: "PPOY",
      site: "SSP",
      age: 17,
      amount: 18_400,
      owner: "_",
      priority: "MEDIUM",
      next: "Confirm effective date with credentialing",
      due: 6,
      credLink: true,
    },
    {
      queue: cred,
      type: "DENIAL",
      payer: "DEMOCOM",
      plan: "PPOY",
      site: "SSP",
      age: 45,
      amount: 15_300,
      owner: "D",
      priority: "HIGH",
      denial: "CO-170",
      next: "Rebill after retro-effective enrollment",
      due: -1,
      credLink: true,
      follow: [[7, "PAYER_CALL", "Denied: provider not enrolled at location (synthetic)."]],
    },
    // Billing quality
    {
      queue: quality,
      type: "CODING_REVIEW",
      payer: "DEMOMCD",
      plan: "MMC",
      site: "NEDC",
      age: 9,
      amount: 11_200,
      owner: "D",
      priority: "MEDIUM",
      next: "Coder review of modifier usage",
      due: 2,
    },
    {
      queue: quality,
      type: "CORRECTED_CLAIM",
      payer: "DEMOCOM",
      plan: "PPOY",
      site: "ALX",
      age: 14,
      amount: 6_700,
      owner: "R",
      priority: "LOW",
      next: "Submit corrected claim (frequency code 7)",
      due: 0,
    },
    {
      queue: quality,
      type: "CODING_REVIEW",
      payer: "DEMOCOM",
      plan: "PPOY",
      site: "NEDC",
      age: 6,
      amount: 13_000,
      owner: "_",
      priority: "MEDIUM",
      next: "Documentation check",
      due: 4,
    },
    {
      queue: quality,
      type: "CORRECTED_CLAIM",
      payer: "DEMOMCD",
      plan: "MMC",
      site: "SSP",
      age: 21,
      amount: 4_400,
      owner: "D",
      priority: "LOW",
      next: "—",
      due: 5,
      status: "RESOLVED",
      follow: [[4, "CORRECTED_CLAIM_SUBMITTED", "Accepted (synthetic)."]],
    },
  ];

  let n = 0;
  const ids: string[] = [];
  for (const s of specs) {
    n++;
    const owner = owners[s.owner];
    const actor = owner ?? sup;
    const createdDaysAgo = Math.max(1, s.age - 20);
    const linkCred = s.credLink && credCase && pracD;
    const c = await createCase(
      db,
      sup,
      {
        queueId: s.queue.id,
        caseType: s.type,
        claimRef: `SYN-CLM-${String(10000 + n)}`,
        payerId: payer(s.payer),
        payerPlanId: s.plan ? plan(s.plan) : null,
        siteId: site(s.site),
        serviceDate: addDays(today, -s.age),
        amountCents: s.amount * 100,
        denialCode: s.denial ?? null,
        priority: s.priority,
        ownerUserId: owner?.userId ?? null,
        nextAction: s.next === "—" ? null : s.next,
        nextActionDue: addDays(today, s.due),
        credentialingCaseId: linkCred ? credCase.id : null,
      },
      { now: at(createdDaysAgo, 9) },
    );
    ids.push(c.id);
    let version = c.version;
    for (const [daysAgo, type, note] of s.follow ?? []) {
      const r = await addCaseAction(db, actor, c.id, { type, note }, { now: at(Math.min(daysAgo, createdDaysAgo), 11) });
      version = r.version;
    }
    // Restore the intended next-action date (follow-ups may have moved it).
    if (s.follow?.length && s.next !== "—") {
      const r = await updateCase(db, actor, c.id, { version, nextAction: s.next, nextActionDue: addDays(today, s.due) }, { now: at(0, 8) });
      version = r.version;
    }
    if (s.status === "WAITING_PAYER") version = (await updateCase(db, actor, c.id, { version, status: "WAITING_PAYER" }, { now: at(1, 9) })).version;
    if (s.status === "ESCALATED")
      version = (await escalateCase(db, actor, c.id, { version, reason: "Over 120 days with no adjudication (synthetic)." }, { now: at(2, 9) })).version;
    if (s.status === "RESOLVED" || s.status === "CLOSED_NO_ACTION")
      version = (
        await updateCase(
          db,
          actor,
          c.id,
          { version, status: s.status, resolutionNote: s.status === "RESOLVED" ? "Paid (synthetic)." : "Small balance write-off per policy (synthetic)." },
          { now: at(3, 15) },
        )
      ).version;
  }

  // Workflow link: the first aging case is tracked as a task in the "Reduce >90-Day A/R" project.
  const [bill] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.organizationId, o), eq(projects.key, "BILL")));
  if (bill) await linkCaseTask(db, riley, ids[8]!, { projectId: bill.id });

  // Populate the inbox once so the demo shows reminders before the worker's first tick.
  await scanRcmDue(db, { organizationId: o, now });
  await dispatchOutbox(db, { limit: 500 });
  return { skipped: false as const, queues: 4, cases: specs.length };
}

if (isMain(import.meta.url)) {
  loadRootEnv();
  const pw = process.env.DEMO_PASSWORD;
  if (!pw || pw.length < 12) {
    console.error("DEMO_PASSWORD must be set (>= 12 chars) in .env.");
    process.exit(1);
  }
  const { sql, db } = createDb(undefined, 2);
  seedRcm(db, pw)
    .then((r) => console.log(JSON.stringify({ level: "info", msg: r.skipped ? "RCM demo data already seeded — skipping" : "synthetic RCM data seeded", ...r })))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}
