import { eq } from "drizzle-orm";
import { createDb, isMain, loadRootEnv, type Db } from "@projectos/db";
import { departments, projectTemplates, sites, teams, taskComments, checklistItems } from "@projectos/db/schema";
import { hashPassword } from "better-auth/crypto";
import { loadAuthContext } from "@projectos/auth";
import { SYNTHETIC_LABEL, addDays, appMode, isSyntheticMode, todayIn } from "@projectos/shared";
import { bootstrapOrganization, createMemberDirect, findOrgBySlug } from "./bootstrap";
import { createProject, createMilestone } from "../projects/projects";
import { addDependency, createTask, moveTask } from "../projects/tasks";
import { createRecurringDefinition } from "../projects/recurring";

export const DEMO_ORG_SLUG = "riverbend-demo";
export const DEMO_USERS = {
  admin: { email: "avery.admin@riverbend.example", name: "Avery Admin (Demo)" },
  pm: { email: "pat.morgan@riverbend.example", name: "Pat Morgan (Demo)" },
  scheduler: { email: "sam.ortiz@riverbend.example", name: "Sam Ortiz (Demo)" },
  cred: { email: "casey.lin@riverbend.example", name: "Casey Lin (Demo)" },
  rcm: { email: "riley.shah@riverbend.example", name: "Riley Shah (Demo)" },
  auditor: { email: "jordan.kim@riverbend.example", name: "Jordan Kim (Demo)" },
} as const;

export async function seedDemo(db: Db, password: string) {
  if (!isSyntheticMode(appMode())) throw new Error(`Seeding synthetic data is not allowed in APP_MODE=${appMode()}`);
  if (await findOrgBySlug(db, DEMO_ORG_SLUG)) return { skipped: true as const };
  const passwordHash = await hashPassword(password);
  const { org, roleIds } = await bootstrapOrganization(db, { name: `Riverbend Community Health (${SYNTHETIC_LABEL})`, slug: DEMO_ORG_SLUG });
  const o = org.id;
  const [alx, ssp, nedc] = await db
    .insert(sites)
    .values([
      {
        organizationId: o,
        code: "ALX",
        name: "Alexandria Family Clinic",
        state: "VA",
        timezone: "America/New_York",
        addressLine1: "100 Demo Street (synthetic)",
        city: "Alexandria",
        postalCode: "22301",
      },
      {
        organizationId: o,
        code: "SSP",
        name: "Silver Spring Health Center",
        state: "MD",
        timezone: "America/New_York",
        addressLine1: "200 Example Ave (synthetic)",
        city: "Silver Spring",
        postalCode: "20910",
      },
      {
        organizationId: o,
        code: "NEDC",
        name: "Northeast DC Behavioral Health",
        state: "DC",
        timezone: "America/New_York",
        addressLine1: "300 Sample Blvd (synthetic)",
        city: "Washington",
        postalCode: "20002",
      },
    ])
    .returning();
  const deptRows = await db
    .insert(departments)
    .values([
      { organizationId: o, code: "ADMIN", name: "Administration" },
      { organizationId: o, code: "SCHED", name: "Scheduling & Access" },
      { organizationId: o, code: "CRED", name: "Credentialing" },
      { organizationId: o, code: "RCM", name: "Revenue Cycle" },
      { organizationId: o, code: "BH", name: "Behavioral Health", siteId: nedc!.id },
    ])
    .returning();
  const dept = Object.fromEntries(deptRows.map((d) => [d.code, d.id])) as Record<string, string>;
  await db.insert(teams).values([
    { organizationId: o, departmentId: dept.SCHED!, name: "Front Desk — Alexandria" },
    { organizationId: o, departmentId: dept.RCM!, name: "Denials Team" },
  ]);

  const mk = (k: keyof typeof DEMO_USERS, extra: Omit<Parameters<typeof createMemberDirect>[1], "organizationId" | "email" | "displayName" | "passwordHash">) =>
    createMemberDirect(db, { organizationId: o, email: DEMO_USERS[k].email, displayName: DEMO_USERS[k].name, passwordHash, ...extra });
  const admin = await mk("admin", { professionalRole: "Operations Director", departmentId: dept.ADMIN, grants: [{ roleId: roleIds.org_admin! }] });
  const pm = await mk("pm", { professionalRole: "Project Manager", departmentId: dept.ADMIN, grants: [{ roleId: roleIds.project_manager! }, { roleId: roleIds.executive! }] });
  await mk("scheduler", { professionalRole: "Patient Access Representative", departmentId: dept.SCHED, grants: [{ roleId: roleIds.scheduler!, siteId: alx!.id }] });
  const cred = await mk("cred", {
    professionalRole: "Credentialing Specialist",
    departmentId: dept.CRED,
    grants: [{ roleId: roleIds.credentialing_specialist!, departmentId: dept.CRED }],
  });
  const rcm = await mk("rcm", { professionalRole: "Billing Follow-up Analyst", departmentId: dept.RCM, grants: [{ roleId: roleIds.rcm_analyst!, departmentId: dept.RCM }] });
  await mk("auditor", { professionalRole: "Compliance Auditor", departmentId: dept.ADMIN, grants: [{ roleId: roleIds.auditor! }] });

  const ctx = (await loadAuthContext(db, admin.userId, "seed"))!;
  const today = todayIn("America/New_York");

  await db.insert(projectTemplates).values([
    {
      organizationId: o,
      departmentId: dept.CRED,
      name: "Provider Onboarding (Credentialing)",
      description: "Standard onboarding checklist for a newly hired provider. Synthetic template.",
      milestones: [
        { name: "Documents collected", offsetDays: 14 },
        { name: "Ready to schedule", offsetDays: 60 },
      ],
      tasks: [
        { title: "Collect CV, attestation and supporting documents", priority: "HIGH", offsetDays: 7, milestone: "Documents collected", labels: ["intake"] },
        { title: "Primary-source verify state license(s)", priority: "HIGH", offsetDays: 14, milestone: "Documents collected", labels: ["license"] },
        { title: "Submit payer enrollment applications", priority: "MEDIUM", offsetDays: 21, labels: ["payer"] },
        { title: "Configure EHR/provider schedule template", priority: "MEDIUM", offsetDays: 45, milestone: "Ready to schedule" },
        { title: "Credentialing committee approval", priority: "HIGH", offsetDays: 50, milestone: "Ready to schedule" },
      ],
    },
    {
      organizationId: o,
      departmentId: dept.RCM,
      name: "Denial Initiative (Revenue Cycle)",
      description: "Root-cause and work down a denial category. Synthetic template.",
      milestones: [{ name: "Baseline measured", offsetDays: 7 }],
      tasks: [
        { title: "Pull baseline denial counts by reason (de-identified)", priority: "HIGH", offsetDays: 5, milestone: "Baseline measured", labels: ["analysis"] },
        { title: "Identify top 3 root causes", priority: "MEDIUM", offsetDays: 14, labels: ["analysis"] },
        { title: "Draft front-end prevention workflow", priority: "MEDIUM", offsetDays: 28 },
      ],
    },
  ]);

  // ---- Project 1: Billing improvement (RCM department) ----
  const bill = (await createProject(db, ctx, {
    key: "BILL",
    name: "Billing Improvement — Reduce >90-Day A/R",
    description: `${SYNTHETIC_LABEL}. Work down aged follow-up categories and prevent recurrence. No real claims or patient data.`,
    departmentId: dept.RCM,
    ownerUserId: pm.userId,
    startDate: addDays(today, -21),
    dueDate: addDays(today, 70),
  }))!;
  const m1 = await createMilestone(db, ctx, bill.id, { name: "Baseline and segmentation", dueDate: addDays(today, -3) });
  const m2 = await createMilestone(db, ctx, bill.id, { name: "Top payer follow-up sprint", dueDate: addDays(today, 30) });
  const t = async (input: Record<string, unknown>) => (await createTask(db, ctx, { projectId: bill.id, ...input })).task;
  const b1 = await t({
    title: "Export de-identified aging summary by payer",
    priority: "HIGH",
    ownerUserId: rcm.userId,
    dueDate: addDays(today, -10),
    milestoneId: m1.id,
    labels: ["analysis"],
  });
  const b2 = await t({
    title: "Segment >90-day balances by denial reason",
    priority: "HIGH",
    ownerUserId: rcm.userId,
    dueDate: addDays(today, -2),
    milestoneId: m1.id,
    labels: ["analysis"],
  });
  const b3 = await t({
    title: "Build follow-up worklist for top 5 payers",
    priority: "URGENT",
    ownerUserId: rcm.userId,
    collaboratorUserIds: [pm.userId],
    dueDate: today,
    milestoneId: m2.id,
    labels: ["worklist"],
  });
  const b4 = await t({
    title: "Escalate credentialing-related denials to Credentialing",
    priority: "MEDIUM",
    ownerUserId: cred.userId,
    dueDate: addDays(today, 5),
    milestoneId: m2.id,
    labels: ["credentialing", "escalation"],
  });
  const b5 = await t({ title: "Weekly status readout to CFO", priority: "LOW", ownerUserId: pm.userId, dueDate: addDays(today, 7), labels: ["reporting"] });
  const b6 = await t({ title: "Corrected-claim backlog triage", priority: "MEDIUM", ownerUserId: rcm.userId, dueDate: addDays(today, 14), milestoneId: m2.id });
  await t({ title: "Document timely-filing rules per payer contract (config, not hard-coded)", priority: "MEDIUM", dueDate: addDays(today, 21), labels: ["policy"] });
  await t({ title: "Pull aging export sub-step: validate payer mapping", parentTaskId: b1.id, priority: "LOW", ownerUserId: rcm.userId });
  await moveTask(db, ctx, b1.id, { status: "DONE", version: b1.version });
  await moveTask(db, ctx, b2.id, { status: "IN_REVIEW", version: b2.version });
  await moveTask(db, ctx, b3.id, { status: "IN_PROGRESS", version: b3.version });
  await moveTask(db, ctx, b6.id, { status: "IN_PROGRESS", version: b6.version });
  await addDependency(db, ctx, b3.id, { blockingTaskId: b2.id });
  await addDependency(db, ctx, b5.id, { blockingTaskId: b3.id });
  await addDependency(db, ctx, b4.id, { blockingTaskId: b2.id, kind: "RELATED" });
  await db.insert(checklistItems).values([
    { organizationId: o, taskId: b3.id, text: "Confirm payer list with supervisor", done: true, position: 1 },
    { organizationId: o, taskId: b3.id, text: "Assign owners per payer", position: 2 },
    { organizationId: o, taskId: b3.id, text: "Set follow-up due dates", position: 3 },
  ]);
  await db.insert(taskComments).values({ organizationId: o, taskId: b3.id, authorUserId: pm.userId, body: "Synthetic note: start with the two payers with the oldest balances." });
  await createRecurringDefinition(db, ctx, {
    projectId: bill.id,
    title: "Review aging trend report",
    cadence: "WEEKLY",
    weekday: 1,
    timezone: "America/New_York",
    startOn: addDays(today, -14),
    ownerUserId: rcm.userId,
    dueInDays: 1,
    priority: "MEDIUM",
  });

  // ---- Project 2: Provider onboarding (Credentialing department), from template ----
  const tmpl = await db.select().from(projectTemplates).where(eq(projectTemplates.name, "Provider Onboarding (Credentialing)"));
  const onb = (await createProject(db, ctx, {
    key: "ONB",
    name: "Provider Onboarding — Q4 Cohort",
    description: `${SYNTHETIC_LABEL}. Onboard three fictional providers (Practitioner A/B/C). Not real people; no real license data.`,
    departmentId: dept.CRED,
    ownerUserId: cred.userId,
    startDate: addDays(today, -10),
    dueDate: addDays(today, 60),
    templateId: tmpl[0]!.id,
  }))!;
  await createTask(db, ctx, {
    projectId: onb.id,
    title: "Practitioner B (RN): record synthetic multistate authorization evidence",
    priority: "HIGH",
    ownerUserId: cred.userId,
    dueDate: addDays(today, 3),
    labels: ["license", "demo-fixture"],
  });
  await createTask(db, ctx, {
    projectId: onb.id,
    title: "Practitioner C (psychologist): request APIT evidence (synthetic)",
    priority: "MEDIUM",
    ownerUserId: cred.userId,
    dueDate: addDays(today, -1),
    labels: ["license", "demo-fixture"],
  });

  return { skipped: false as const, organizationId: o, sites: [alx!.code, ssp!.code, nedc!.code] };
}

if (isMain(import.meta.url)) {
  loadRootEnv();
  const pw = process.env.DEMO_PASSWORD;
  if (!pw || pw.length < 12) {
    console.error("DEMO_PASSWORD must be set (>= 12 chars) in .env to seed synthetic demo users.");
    process.exit(1);
  }
  const { sql, db } = createDb(undefined, 2);
  seedDemo(db, pw)
    .then((r) => {
      console.log(JSON.stringify({ level: "info", msg: r.skipped ? "demo organization already seeded — skipping" : "synthetic demo data seeded", ...r }));
      if (!r.skipped)
        console.log(
          `Demo sign-in emails: ${Object.values(DEMO_USERS)
            .map((u) => u.email)
            .join(", ")} (password = DEMO_PASSWORD from .env)`,
        );
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}
