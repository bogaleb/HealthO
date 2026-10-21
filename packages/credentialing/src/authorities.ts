import { and, desc, eq } from "drizzle-orm";
import type { Db, Tx } from "@projectos/db";
import { authorityVerifications, memberships, professionalAuthorities } from "@projectos/db/schema";
import type { AuthContext } from "@projectos/auth";
import { audit, authorize, parse } from "@projectos/core";
import { AppError, authorityCreate, authorityReject, authorityReview, authorityStatusChange, authoritySubmit, notFound, versionConflict } from "@projectos/shared";
import { canOnPractitioner, dualControlEnabled, loadPractitioner } from "./access";

type Authority = typeof professionalAuthorities.$inferSelect;

async function loadAuthority(db: Db, ctx: AuthContext, id: string) {
  const [a] = await db
    .select()
    .from(professionalAuthorities)
    .where(and(eq(professionalAuthorities.organizationId, ctx.organizationId), eq(professionalAuthorities.id, id)));
  if (!a) throw notFound("Authority");
  const { siteIds } = await loadPractitioner(db, ctx, a.practitionerId); // visibility check → 404 if out of scope
  return { a, siteIds };
}

async function requirePerm(db: Db, ctx: AuthContext, perm: "credentialing.edit" | "credentialing.approve", siteIds: string[], action: string, id: string) {
  if (!canOnPractitioner(ctx, perm, siteIds)) await authorize(db, ctx, perm, {}, { action, resourceType: "authority", resourceId: id });
}

async function transition(
  tx: Tx,
  ctx: AuthContext,
  a: Authority,
  version: number,
  to: string,
  set: Partial<typeof professionalAuthorities.$inferInsert>,
  history: { action: string; sourceName?: string | null; sourceUrl?: string | null; verifiedOn?: string | null; note?: string | null },
) {
  const [row] = await tx
    .update(professionalAuthorities)
    .set({ ...set, status: to, version: version + 1 })
    .where(and(eq(professionalAuthorities.id, a.id), eq(professionalAuthorities.organizationId, ctx.organizationId), eq(professionalAuthorities.version, version)))
    .returning();
  if (!row) throw versionConflict();
  await tx.insert(authorityVerifications).values({
    organizationId: ctx.organizationId,
    authorityId: a.id,
    action: history.action,
    fromStatus: a.status,
    toStatus: to,
    actorUserId: ctx.userId,
    sourceName: history.sourceName ?? null,
    sourceUrl: history.sourceUrl ?? null,
    verifiedOn: history.verifiedOn ?? null,
    note: history.note ?? null,
  });
  await audit(tx, ctx, {
    action: `authority.${history.action.toLowerCase()}`,
    resourceType: "authority",
    resourceId: a.id,
    metadata: { from: a.status, to, practitionerId: a.practitionerId },
  });
  return row;
}

export async function listAuthorityHistory(db: Db, ctx: AuthContext, authorityId: string) {
  await loadAuthority(db, ctx, authorityId);
  return db
    .select({ h: authorityVerifications, actorName: memberships.displayName })
    .from(authorityVerifications)
    .leftJoin(memberships, and(eq(memberships.userId, authorityVerifications.actorUserId), eq(memberships.organizationId, authorityVerifications.organizationId)))
    .where(and(eq(authorityVerifications.organizationId, ctx.organizationId), eq(authorityVerifications.authorityId, authorityId)))
    .orderBy(desc(authorityVerifications.createdAt))
    .then((rows) => rows.map((r) => ({ ...r.h, actorName: r.actorName })));
}

/** Records new evidence as DRAFT. Never verified on entry. */
export async function createAuthority(db: Db, ctx: AuthContext, practitionerId: string, input: unknown) {
  const { practitioner } = await loadPractitioner(db, ctx, practitionerId, { perm: "credentialing.edit", action: "authority.create" });
  const d = parse(authorityCreate, input);
  if (d.authorityType !== "COMPACT_MEMBERSHIP_CLAIM" && d.profession !== practitioner.profession) {
    throw new AppError("VALIDATION_FAILED", `Authority profession must match the provider's profession (${practitioner.profession}).`, [
      { code: "PROFESSION_MISMATCH", field: "profession" },
    ]);
  }
  return db.transaction(async (tx) => {
    const [a] = await tx
      .insert(professionalAuthorities)
      .values({ ...d, organizationId: ctx.organizationId, practitionerId, status: "DRAFT", createdBy: ctx.userId })
      .returning();
    await tx.insert(authorityVerifications).values({ organizationId: ctx.organizationId, authorityId: a!.id, action: "CREATE", toStatus: "DRAFT", actorUserId: ctx.userId });
    await audit(tx, ctx, {
      action: "authority.create",
      resourceType: "authority",
      resourceId: a!.id,
      metadata: { practitionerId, type: d.authorityType, jurisdiction: d.jurisdiction },
    });
    return a!;
  });
}

export async function submitAuthority(db: Db, ctx: AuthContext, id: string, input: unknown) {
  const { a, siteIds } = await loadAuthority(db, ctx, id);
  await requirePerm(db, ctx, "credentialing.edit", siteIds, "authority.submit", id);
  const { version } = parse(authoritySubmit, input);
  if (a.status !== "DRAFT" && a.status !== "REJECTED") throw new AppError("CONFLICT", `Only draft or rejected evidence can be submitted (current: ${a.status}).`);
  return db.transaction((tx) => transition(tx, ctx, a, version, "SUBMITTED", { submittedBy: ctx.userId, submittedAt: new Date() }, { action: "SUBMIT" }));
}

/** Verification by a credentialing approver against a named primary source. Dual control: not your own submission. */
export async function verifyAuthority(db: Db, ctx: AuthContext, id: string, input: unknown) {
  const { a, siteIds } = await loadAuthority(db, ctx, id);
  await requirePerm(db, ctx, "credentialing.approve", siteIds, "authority.verify", id);
  const d = parse(authorityReview, input);
  if (a.status !== "SUBMITTED") throw new AppError("CONFLICT", "Only submitted evidence can be verified.");
  if (a.authorityType === "COMPACT_MEMBERSHIP_CLAIM")
    throw new AppError("VALIDATION_FAILED", "A compact membership claim is informational and cannot be verified as an authority.");
  if ((await dualControlEnabled(db, ctx.organizationId)) && (a.submittedBy === ctx.userId || a.createdBy === ctx.userId)) {
    await audit(db, ctx, { action: "authority.verify", resourceType: "authority", resourceId: id, outcome: "DENY", metadata: { reason: "dual_control" } });
    throw new AppError("FORBIDDEN", "Dual control: someone other than the person who entered or submitted this evidence must verify it.");
  }
  return db.transaction((tx) =>
    transition(
      tx,
      ctx,
      a,
      d.version,
      "VERIFIED",
      { verifiedBy: ctx.userId, verifiedAt: new Date(), nextReviewOn: d.nextReviewOn ?? null },
      {
        action: "VERIFY",
        sourceName: d.sourceName,
        sourceUrl: d.sourceUrl,
        verifiedOn: d.verifiedOn,
        note: d.note,
      },
    ),
  );
}

export async function rejectAuthority(db: Db, ctx: AuthContext, id: string, input: unknown) {
  const { a, siteIds } = await loadAuthority(db, ctx, id);
  await requirePerm(db, ctx, "credentialing.approve", siteIds, "authority.reject", id);
  const d = parse(authorityReject, input);
  if (a.status !== "SUBMITTED") throw new AppError("CONFLICT", "Only submitted evidence can be rejected.");
  return db.transaction((tx) => transition(tx, ctx, a, d.version, "REJECTED", { verifiedBy: null, verifiedAt: null }, { action: "REJECT", note: d.note }));
}

/** Suspend or revoke (e.g. board action). Blocks readiness immediately for that profession + jurisdiction. */
export async function changeAuthorityStatus(db: Db, ctx: AuthContext, id: string, input: unknown) {
  const { a, siteIds } = await loadAuthority(db, ctx, id);
  await requirePerm(db, ctx, "credentialing.approve", siteIds, "authority.status", id);
  const d = parse(authorityStatusChange, input);
  if (a.status === "REVOKED") throw new AppError("CONFLICT", "Revoked authority cannot change status.");
  return db.transaction((tx) => transition(tx, ctx, a, d.version, d.status, {}, { action: d.status === "SUSPENDED" ? "SUSPEND" : "REVOKE", note: d.note }));
}
