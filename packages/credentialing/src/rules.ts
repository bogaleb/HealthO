import { and, asc, desc, eq, sql } from "drizzle-orm";
import { qualified, type Db } from "@projectos/db";
import { licensePolicyRules } from "@projectos/db/schema";
import { hasAny, type AuthContext } from "@projectos/auth";
import { audit, authorize, parse } from "@projectos/core";
import { AppError, notFound, ruleApprove, ruleCreate, ruleRetire } from "@projectos/shared";
import { dualControlEnabled, requestRescreen } from "./access";

export async function listRules(db: Db, ctx: AuthContext) {
  if (!hasAny(ctx, "credentialing.read") && !hasAny(ctx, "policy.publish")) await authorize(db, ctx, "credentialing.read", "ANY");
  const creator = sql<
    string | null
  >`(select m.display_name from memberships m where m.user_id = ${qualified(licensePolicyRules.createdBy)} and m.organization_id = ${qualified(licensePolicyRules.organizationId)})`;
  const approver = sql<
    string | null
  >`(select m.display_name from memberships m where m.user_id = ${qualified(licensePolicyRules.approvedBy)} and m.organization_id = ${qualified(licensePolicyRules.organizationId)})`;
  const rows = await db
    .select({ r: licensePolicyRules, creatorName: creator, approverName: approver })
    .from(licensePolicyRules)
    .where(eq(licensePolicyRules.organizationId, ctx.organizationId))
    .orderBy(asc(licensePolicyRules.jurisdiction), asc(licensePolicyRules.profession), asc(licensePolicyRules.modality), desc(licensePolicyRules.createdAt));
  return rows.map((x) => ({ ...x.r, creatorName: x.creatorName, approverName: x.approverName }));
}

export async function loadApprovedRules(db: Db, organizationId: string) {
  return db
    .select()
    .from(licensePolicyRules)
    .where(and(eq(licensePolicyRules.organizationId, organizationId), eq(licensePolicyRules.status, "APPROVED")));
}

/** Drafts may be authored by credentialing editors or policy publishers. Drafts never affect readiness. */
export async function createRuleDraft(db: Db, ctx: AuthContext, input: unknown) {
  if (!hasAny(ctx, "policy.publish")) await authorize(db, ctx, "credentialing.edit", {}, { action: "rule.create", resourceType: "license_policy_rule" });
  const d = parse(ruleCreate, input);
  const needsHomes = d.authorizationBasis.some((b) => b === "MULTISTATE_LICENSE" || b === "APIT");
  if (needsHomes && !d.acceptedHomeStates.length) {
    throw new AppError("VALIDATION_FAILED", "Multistate/APIT bases require the explicit list of accepted home states — compact membership is never inferred.", [
      { code: "HOME_STATES_REQUIRED", field: "acceptedHomeStates" },
    ]);
  }
  if (d.effectiveTo && d.effectiveTo <= d.effectiveFrom)
    throw new AppError("VALIDATION_FAILED", "Effective-to must be after effective-from.", [{ code: "DATE_ORDER", field: "effectiveTo" }]);
  const ruleKey = `${d.jurisdiction}-${d.profession}-${d.modality}${d.serviceCategory ? `-${d.serviceCategory}` : ""}`;
  const [{ n }] = (await db.execute<{ n: number }>(
    sql`select count(*)::int as n from license_policy_rules where organization_id = ${ctx.organizationId} and rule_key = ${ruleKey}`,
  )) as unknown as [{ n: number }];
  return db.transaction(async (tx) => {
    const [r] = await tx
      .insert(licensePolicyRules)
      .values({ ...d, ruleKey, ruleVersion: String(n + 1), organizationId: ctx.organizationId, createdBy: ctx.userId, status: "DRAFT" })
      .returning();
    await audit(tx, ctx, { action: "rule.create", resourceType: "license_policy_rule", resourceId: r!.id, metadata: { ruleKey, version: r!.ruleVersion, isDemo: d.isDemo } });
    return r!;
  });
}

/** Publish (APPROVE). Requires policy.publish; with dual control the approver cannot be the author. Supersedes older approved versions. */
export async function approveRule(db: Db, ctx: AuthContext, id: string, input: unknown) {
  await authorize(db, ctx, "policy.publish", {}, { action: "rule.approve", resourceType: "license_policy_rule", resourceId: id });
  const d = parse(ruleApprove, input);
  const [r] = await db
    .select()
    .from(licensePolicyRules)
    .where(and(eq(licensePolicyRules.organizationId, ctx.organizationId), eq(licensePolicyRules.id, id)));
  if (!r) throw notFound("Rule");
  if (r.status !== "DRAFT") throw new AppError("CONFLICT", "Only draft rules can be approved.");
  if ((await dualControlEnabled(db, ctx.organizationId)) && r.createdBy === ctx.userId) {
    await audit(db, ctx, { action: "rule.approve", resourceType: "license_policy_rule", resourceId: id, outcome: "DENY", metadata: { reason: "dual_control" } });
    throw new AppError("FORBIDDEN", "Dual control: a different person must approve this rule.");
  }
  const approved = await db.transaction(async (tx) => {
    const superseded = await tx
      .update(licensePolicyRules)
      .set({ status: "RETIRED", retiredBy: ctx.userId, retiredAt: new Date() })
      .where(and(eq(licensePolicyRules.organizationId, ctx.organizationId), eq(licensePolicyRules.ruleKey, r.ruleKey), eq(licensePolicyRules.status, "APPROVED")))
      .returning({ id: licensePolicyRules.id });
    const [row] = await tx
      .update(licensePolicyRules)
      .set({ status: "APPROVED", approvedBy: ctx.userId, approvedAt: new Date(), approvalReason: d.reason, supersedesId: superseded[0]?.id ?? null })
      .where(and(eq(licensePolicyRules.id, id), eq(licensePolicyRules.status, "DRAFT")))
      .returning();
    if (!row) throw new AppError("CONFLICT", "Rule changed concurrently; reload.");
    await audit(tx, ctx, {
      action: "rule.approve",
      resourceType: "license_policy_rule",
      resourceId: id,
      metadata: { ruleKey: r.ruleKey, supersedes: superseded.map((s) => s.id) },
    });
    return row;
  });
  await requestRescreen(db, ctx.organizationId, `rule:${id}:approved`);
  return approved;
}

export async function retireRule(db: Db, ctx: AuthContext, id: string, input: unknown) {
  await authorize(db, ctx, "policy.publish", {}, { action: "rule.retire", resourceType: "license_policy_rule", resourceId: id });
  parse(ruleRetire, input);
  const retired = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(licensePolicyRules)
      .set({ status: "RETIRED", retiredBy: ctx.userId, retiredAt: new Date() })
      .where(and(eq(licensePolicyRules.organizationId, ctx.organizationId), eq(licensePolicyRules.id, id), eq(licensePolicyRules.status, "APPROVED")))
      .returning();
    if (!row) throw new AppError("CONFLICT", "Only approved rules can be retired.");
    await audit(tx, ctx, { action: "rule.retire", resourceType: "license_policy_rule", resourceId: id });
    return row;
  });
  await requestRescreen(db, ctx.organizationId, `rule:${id}:retired`);
  return retired;
}
