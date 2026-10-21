import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@projectos/db";
import { departments, idempotencyKeys, practitioners, projects, sites, tasks } from "@projectos/db/schema";
import { audit } from "@projectos/core";
import { addDays, CATEGORY_META, todayIn, type EligibilityCategory } from "@projectos/shared";
import type { EligibilityResult, EvaluateInput } from "./eligibility";

const PROJECT_KEY = "ELIG";

async function ensureProject(db: Db, organizationId: string) {
  const find = () =>
    db
      .select()
      .from(projects)
      .where(and(eq(projects.organizationId, organizationId), eq(projects.key, PROJECT_KEY)));
  const [existing] = await find();
  if (existing) return existing;
  const [dept] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.organizationId, organizationId), eq(departments.code, "CRED")));
  const [p] = await db
    .insert(projects)
    .values({
      organizationId,
      key: PROJECT_KEY,
      name: "Eligibility follow-ups (system-generated)",
      description: "Policy and evidence tasks created when license or payer readiness blocks or holds a booking. No patient details are included.",
      departmentId: dept?.id ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (p) {
    await audit(db, { system: "scheduling.eligibility", organizationId }, { action: "project.create", resourceType: "project", resourceId: p.id });
    return p;
  }
  return (await find())[0]!;
}

/**
 * Create (at most once per provider × context × reason × month) a credentialing/compliance task for each
 * license or payer reason that stopped a booking. Titles carry provider, jurisdiction and reason code only —
 * never the patient. Idempotent across retries and concurrent requests (idempotency_keys unique constraint).
 */
export async function ensureEligibilityTasks(db: Db, organizationId: string, input: EvaluateInput, r: EligibilityResult) {
  const actionable = r.flags.filter((f) => f.severity !== "INFO" && f.category !== "INFO" && CATEGORY_META[f.category as EligibilityCategory].createsTask);
  if (!actionable.length) return [];
  const [p] = await db.select({ name: practitioners.displayName }).from(practitioners).where(eq(practitioners.id, input.practitionerId));
  const [s] = await db.select({ code: sites.code }).from(sites).where(eq(sites.id, input.siteId));
  const month = todayIn("America/New_York").slice(0, 7);
  const created: string[] = [];
  for (const f of actionable) {
    const scope = f.category === "PAYER_NOT_READY" ? `${input.siteId}:${input.payerPlanId}` : `${r.jurisdiction}:${input.modality}`;
    const key = `elig:${input.practitionerId}:${scope}:${f.code}:${month}`;
    await db.transaction(async (tx) => {
      const claimed = await tx
        .insert(idempotencyKeys)
        .values({ organizationId, scope: "eligibility.task", key, resourceId: input.practitionerId })
        .onConflictDoNothing()
        .returning({ id: idempotencyKeys.id });
      if (!claimed.length) return;
      const project = await ensureProject(tx as unknown as Db, organizationId);
      const [seq] = await tx
        .update(projects)
        .set({ taskSeq: sql`${projects.taskSeq} + 1` })
        .where(eq(projects.id, project.id))
        .returning({ n: projects.taskSeq });
      const meta = CATEGORY_META[f.category as EligibilityCategory];
      const where = f.category === "PAYER_NOT_READY" ? `site ${s?.code ?? "?"}` : `${r.jurisdiction ?? "?"} · ${input.modality.toLowerCase().replace("_", " ")}`;
      const [t] = await tx
        .insert(tasks)
        .values({
          organizationId,
          projectId: project.id,
          number: seq!.n,
          title: `${meta.label}: ${f.code} — ${p?.name ?? "provider"} (${where})`,
          description: `${f.message}\n\nNext step: ${meta.remediation}\nOwner: ${meta.owner}.\nCreated automatically because a booking attempt was held or blocked. No patient information is recorded here.`,
          priority: f.severity === "BLOCK" ? "HIGH" : "MEDIUM",
          dueDate: addDays(todayIn("America/New_York"), 5),
          labels: ["eligibility", f.category.toLowerCase().replace(/_/g, "-")],
          position: Date.now() / 1000,
        })
        .returning({ id: tasks.id });
      await audit(
        tx,
        { system: "scheduling.eligibility", organizationId },
        { action: "eligibility.task", resourceType: "task", resourceId: t!.id, metadata: { practitionerId: input.practitionerId, code: f.code, category: f.category } },
      );
      created.push(t!.id);
    });
  }
  return created;
}
