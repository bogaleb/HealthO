import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@projectos/db";
import { payerPlans, payers, providerEnrollments } from "@projectos/db/schema";
import type { AuthContext } from "@projectos/auth";
import { audit, authorize, mapDbError, parse } from "@projectos/core";
import { AppError, enrollmentCreate, enrollmentUpdate, enrollmentVerify, notFound, payerCreate, planCreate, versionConflict } from "@projectos/shared";
import { canOnPractitioner, dualControlEnabled, loadPractitioner, requestRescreen } from "./access";

export async function listPayers(db: Db, ctx: AuthContext) {
  await authorize(db, ctx, "credentialing.read", "ANY");
  const [ps, plans] = await Promise.all([
    db.select().from(payers).where(eq(payers.organizationId, ctx.organizationId)).orderBy(asc(payers.name)),
    db.select().from(payerPlans).where(eq(payerPlans.organizationId, ctx.organizationId)).orderBy(asc(payerPlans.name)),
  ]);
  return ps.map((p) => ({ ...p, plans: plans.filter((x) => x.payerId === p.id) }));
}

export async function createPayer(db: Db, ctx: AuthContext, input: unknown) {
  await authorize(db, ctx, "credentialing.edit", {}, { action: "payer.create", resourceType: "payer" });
  const d = parse(payerCreate, input);
  try {
    return await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(payers)
        .values({ ...d, organizationId: ctx.organizationId })
        .returning();
      await audit(tx, ctx, { action: "payer.create", resourceType: "payer", resourceId: p!.id });
      return p!;
    });
  } catch (e) {
    mapDbError(e, "A payer with this code already exists.");
  }
}

export async function createPlan(db: Db, ctx: AuthContext, input: unknown) {
  await authorize(db, ctx, "credentialing.edit", {}, { action: "payer_plan.create", resourceType: "payer_plan" });
  const d = parse(planCreate, input);
  const [p] = await db
    .select({ id: payers.id })
    .from(payers)
    .where(and(eq(payers.organizationId, ctx.organizationId), eq(payers.id, d.payerId)));
  if (!p) throw new AppError("VALIDATION_FAILED", "Unknown payer.", [{ code: "UNKNOWN_PAYER", field: "payerId" }]);
  try {
    return await db.transaction(async (tx) => {
      const [plan] = await tx
        .insert(payerPlans)
        .values({ ...d, organizationId: ctx.organizationId })
        .returning();
      await audit(tx, ctx, { action: "payer_plan.create", resourceType: "payer_plan", resourceId: plan!.id });
      return plan!;
    });
  } catch (e) {
    mapDbError(e, "A plan with this code already exists for the payer.");
  }
}

export async function createEnrollment(db: Db, ctx: AuthContext, input: unknown) {
  const d = parse(enrollmentCreate, input);
  const { siteIds } = await loadPractitioner(db, ctx, d.practitionerId, { perm: "credentialing.edit", action: "enrollment.create" });
  if (!siteIds.includes(d.siteId)) throw new AppError("VALIDATION_FAILED", "The provider is not affiliated with that site.", [{ code: "SITE_NOT_AFFILIATED", field: "siteId" }]);
  if (d.status === "APPROVED") throw new AppError("VALIDATION_FAILED", "Create the enrollment first, then record approval with its dates.");
  const [plan] = await db
    .select({ id: payerPlans.id })
    .from(payerPlans)
    .where(and(eq(payerPlans.organizationId, ctx.organizationId), eq(payerPlans.id, d.payerPlanId)));
  if (!plan) throw new AppError("VALIDATION_FAILED", "Unknown plan.", [{ code: "UNKNOWN_PLAN", field: "payerPlanId" }]);
  try {
    return await db.transaction(async (tx) => {
      const [e] = await tx
        .insert(providerEnrollments)
        .values({ ...d, organizationId: ctx.organizationId, statusSetBy: ctx.userId })
        .returning();
      await audit(tx, ctx, {
        action: "enrollment.create",
        resourceType: "enrollment",
        resourceId: e!.id,
        metadata: { practitionerId: d.practitionerId, siteId: d.siteId, status: d.status },
      });
      return e!;
    });
  } catch (e) {
    mapDbError(e, "An enrollment for this provider, plan and site already exists.");
  }
}

async function loadEnrollment(db: Db, ctx: AuthContext, id: string) {
  const [e] = await db
    .select()
    .from(providerEnrollments)
    .where(and(eq(providerEnrollments.organizationId, ctx.organizationId), eq(providerEnrollments.id, id)));
  if (!e) throw notFound("Enrollment");
  const { siteIds } = await loadPractitioner(db, ctx, e.practitionerId);
  return { e, siteIds };
}

/** Status changes always clear prior verification: an approval must be re-verified after any change. */
export async function updateEnrollment(db: Db, ctx: AuthContext, id: string, input: unknown) {
  const { e, siteIds } = await loadEnrollment(db, ctx, id);
  if (!canOnPractitioner(ctx, "credentialing.edit", siteIds))
    await authorize(db, ctx, "credentialing.edit", {}, { action: "enrollment.update", resourceType: "enrollment", resourceId: id });
  const { version, ...d } = parse(enrollmentUpdate, input);
  if (d.status === "APPROVED" && (!d.approvedOn || !d.effectiveOn)) {
    throw new AppError("VALIDATION_FAILED", "Approval needs both the confirmation date and the (possibly retro) effective date.", [
      { code: "APPROVAL_DATES", field: "effectiveOn" },
    ]);
  }
  if (d.status === "TERMINATED" && !d.terminatedOn) throw new AppError("VALIDATION_FAILED", "Termination date is required.", [{ code: "TERMINATION_DATE", field: "terminatedOn" }]);
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(providerEnrollments)
      .set({ ...d, statusSetBy: ctx.userId, verifiedBy: null, verifiedAt: null, verificationSource: null, version: version + 1 })
      .where(and(eq(providerEnrollments.id, id), eq(providerEnrollments.organizationId, ctx.organizationId), eq(providerEnrollments.version, version)))
      .returning();
    if (!row) throw versionConflict();
    await audit(tx, ctx, { action: "enrollment.update", resourceType: "enrollment", resourceId: id, metadata: { from: e.status, to: d.status } });
    return row;
  });
  await requestRescreen(db, ctx.organizationId, `enrollment:${id}:${version + 1}`, e.practitionerId);
  return updated;
}

export async function verifyEnrollment(db: Db, ctx: AuthContext, id: string, input: unknown) {
  const { e, siteIds } = await loadEnrollment(db, ctx, id);
  if (!canOnPractitioner(ctx, "credentialing.approve", siteIds))
    await authorize(db, ctx, "credentialing.approve", {}, { action: "enrollment.verify", resourceType: "enrollment", resourceId: id });
  const d = parse(enrollmentVerify, input);
  if (e.status !== "APPROVED") throw new AppError("CONFLICT", "Only an approved enrollment can be verified.");
  if ((await dualControlEnabled(db, ctx.organizationId)) && e.statusSetBy === ctx.userId) {
    await audit(db, ctx, { action: "enrollment.verify", resourceType: "enrollment", resourceId: id, outcome: "DENY", metadata: { reason: "dual_control" } });
    throw new AppError("FORBIDDEN", "Dual control: someone other than the person who recorded the approval must verify it.");
  }
  const verified = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(providerEnrollments)
      .set({ verifiedBy: ctx.userId, verifiedAt: new Date(), verificationSource: d.sourceName, version: d.version + 1 })
      .where(and(eq(providerEnrollments.id, id), eq(providerEnrollments.version, d.version)))
      .returning();
    if (!row) throw versionConflict();
    await audit(tx, ctx, { action: "enrollment.verify", resourceType: "enrollment", resourceId: id });
    return row;
  });
  await requestRescreen(db, ctx.organizationId, `enrollment:${id}:${d.version + 1}`, e.practitionerId);
  return verified;
}
