import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db, DbOrTx } from "@projectos/db";
import { accounts, departments, invites, memberships, roleGrants, rolePermissions, roles, sites, users } from "@projectos/db/schema";
import type { AuthContext } from "@projectos/auth";
import {
  AppError,
  ORG_WIDE_ONLY,
  inviteAccept,
  inviteCreate,
  isPermission,
  membershipUpdate,
  notFound,
  setMembershipRoles,
  versionConflict,
  type Permission,
} from "@projectos/shared";
import { audit } from "../audit";
import { authorize } from "../authz";
import { assertNoEscalation } from "./roles";
import { parse } from "../util";

type GrantInput = { roleId: string; siteId?: string | null; departmentId?: string | null };

/** Lightweight directory (no emails) for owner pickers — any active member. */
export async function listMemberDirectory(db: DbOrTx, ctx: AuthContext) {
  return db
    .select({ userId: memberships.userId, displayName: memberships.displayName, departmentId: memberships.departmentId })
    .from(memberships)
    .where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.status, "ACTIVE")))
    .orderBy(asc(memberships.displayName));
}

export interface MemberAdminRow {
  membershipId: string;
  userId: string;
  displayName: string;
  email: string;
  status: string;
  professionalRole: string | null;
  departmentId: string | null;
  version: number;
  grants: { id: string; roleId: string; roleName: string; siteId: string | null; departmentId: string | null }[];
}

export async function listMembers(db: Db, ctx: AuthContext, filter: { departmentId?: string; status?: string } = {}): Promise<MemberAdminRow[]> {
  await authorize(db, ctx, "users.manage", {});
  const where = [eq(memberships.organizationId, ctx.organizationId)];
  if (filter.departmentId) where.push(eq(memberships.departmentId, filter.departmentId));
  if (filter.status) where.push(eq(memberships.status, filter.status));
  const ms = await db
    .select({
      membershipId: memberships.id,
      userId: memberships.userId,
      displayName: memberships.displayName,
      email: users.email,
      status: memberships.status,
      professionalRole: memberships.professionalRole,
      departmentId: memberships.departmentId,
      version: memberships.version,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(...where))
    .orderBy(asc(memberships.displayName));
  if (!ms.length) return [];
  const gs = await db
    .select({
      id: roleGrants.id,
      membershipId: roleGrants.membershipId,
      roleId: roleGrants.roleId,
      roleName: roles.name,
      siteId: roleGrants.siteId,
      departmentId: roleGrants.departmentId,
    })
    .from(roleGrants)
    .innerJoin(roles, eq(roles.id, roleGrants.roleId))
    .where(
      and(
        eq(roleGrants.organizationId, ctx.organizationId),
        inArray(
          roleGrants.membershipId,
          ms.map((m) => m.membershipId),
        ),
      ),
    );
  return ms.map((m) => ({ ...m, grants: gs.filter((g) => g.membershipId === m.membershipId) }));
}

/** Validates grants: roles/sites/departments must be in-org, no escalation, org-wide-only perms not scoped. */
async function validateGrants(db: DbOrTx, ctx: AuthContext, grants: GrantInput[]) {
  const roleIds = [...new Set(grants.map((g) => g.roleId))];
  const rs = roleIds.length
    ? await db
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.organizationId, ctx.organizationId), inArray(roles.id, roleIds)))
    : [];
  if (rs.length !== roleIds.length) throw new AppError("VALIDATION_FAILED", "Unknown role.", [{ code: "UNKNOWN_ROLE", field: "grants" }]);
  const perms = roleIds.length
    ? await db
        .select()
        .from(rolePermissions)
        .where(and(eq(rolePermissions.organizationId, ctx.organizationId), inArray(rolePermissions.roleId, roleIds)))
    : [];
  const all = new Set<Permission>();
  for (const g of grants) {
    if (g.siteId && g.departmentId) throw new AppError("VALIDATION_FAILED", "A grant may be scoped to a site or a department, not both.");
    const rp = perms
      .filter((p) => p.roleId === g.roleId)
      .map((p) => p.permission)
      .filter(isPermission);
    rp.forEach((p) => all.add(p));
    if ((g.siteId || g.departmentId) && rp.some((p) => ORG_WIDE_ONLY.includes(p))) {
      throw new AppError("VALIDATION_FAILED", "This role contains organization-wide-only permissions and cannot be scoped.");
    }
    if (g.siteId) {
      const s = await db
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.id, g.siteId)));
      if (!s.length) throw new AppError("VALIDATION_FAILED", "Unknown site.", [{ code: "UNKNOWN_SITE", field: "grants" }]);
    }
    if (g.departmentId) {
      const d = await db
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.organizationId, ctx.organizationId), eq(departments.id, g.departmentId)));
      if (!d.length) throw new AppError("VALIDATION_FAILED", "Unknown department.", [{ code: "UNKNOWN_DEPARTMENT", field: "grants" }]);
    }
  }
  assertNoEscalation(ctx, all);
}

export async function setRoles(db: Db, ctx: AuthContext, membershipId: string, input: unknown) {
  await authorize(db, ctx, "users.manage", {}, { action: "membership.roles.set", resourceType: "membership", resourceId: membershipId });
  const data = parse(setMembershipRoles, input);
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.id, membershipId)));
  if (!m) throw notFound("Member");
  if (m.id === ctx.membershipId) {
    await audit(db, ctx, { action: "membership.roles.set", resourceType: "membership", resourceId: membershipId, outcome: "DENY", metadata: { reason: "self_change" } });
    throw new AppError("ROLE_ESCALATION", "You cannot change your own roles.");
  }
  await validateGrants(db, ctx, data.grants);
  return db.transaction(async (tx) => {
    const [bumped] = await tx
      .update(memberships)
      .set({ version: m.version + 1 })
      .where(and(eq(memberships.id, m.id), eq(memberships.version, data.version)))
      .returning();
    if (!bumped) throw versionConflict();
    await tx.delete(roleGrants).where(and(eq(roleGrants.organizationId, ctx.organizationId), eq(roleGrants.membershipId, m.id)));
    if (data.grants.length) {
      await tx.insert(roleGrants).values(
        data.grants.map((g) => ({
          organizationId: ctx.organizationId,
          membershipId: m.id,
          roleId: g.roleId,
          siteId: g.siteId ?? null,
          departmentId: g.departmentId ?? null,
          grantedBy: ctx.userId,
        })),
      );
    }
    await audit(tx, ctx, { action: "membership.roles.set", resourceType: "membership", resourceId: m.id, metadata: { grants: data.grants } });
    return bumped;
  });
}

export async function updateMembership(db: Db, ctx: AuthContext, membershipId: string, input: unknown) {
  await authorize(db, ctx, "users.manage", {}, { action: "membership.update", resourceType: "membership", resourceId: membershipId });
  const data = parse(membershipUpdate, input);
  if (membershipId === ctx.membershipId) throw new AppError("FORBIDDEN", "You cannot change your own membership status.");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(memberships)
      .set({ status: data.status, version: data.version + 1 })
      .where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.id, membershipId), eq(memberships.version, data.version)))
      .returning();
    if (!row) {
      const [exists] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.id, membershipId)));
      throw exists ? versionConflict() : notFound("Member");
    }
    await audit(tx, ctx, { action: `membership.${data.status === "ACTIVE" ? "reactivate" : "suspend"}`, resourceType: "membership", resourceId: membershipId });
    return row;
  });
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

/**
 * Creates an invite. Returns the one-time token ONCE so the admin can share it.
 * (Local synthetic simulation — production must deliver via an approved email channel.)
 */
export async function createInvite(db: Db, ctx: AuthContext, input: unknown) {
  await authorize(db, ctx, "users.manage", {}, { action: "invite.create", resourceType: "invite" });
  const data = parse(inviteCreate, input);
  await validateGrants(db, ctx, data.grants);
  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email));
  if (existingUser) {
    const [m] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.userId, existingUser.id)));
    if (m) throw new AppError("CONFLICT", "This person is already a member.");
  }
  const token = randomBytes(32).toString("base64url");
  return db.transaction(async (tx) => {
    await tx
      .update(invites)
      .set({ status: "REVOKED" })
      .where(and(eq(invites.organizationId, ctx.organizationId), eq(invites.email, data.email), eq(invites.status, "PENDING")));
    const [row] = await tx
      .insert(invites)
      .values({
        organizationId: ctx.organizationId,
        email: data.email,
        displayName: data.displayName,
        tokenHash: hashToken(token),
        grants: data.grants,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedBy: ctx.userId,
      })
      .returning({ id: invites.id, expiresAt: invites.expiresAt });
    await audit(tx, ctx, { action: "invite.create", resourceType: "invite", resourceId: row!.id, metadata: { grantCount: data.grants.length } });
    return { id: row!.id, expiresAt: row!.expiresAt, token };
  });
}

export async function listInvites(db: Db, ctx: AuthContext) {
  await authorize(db, ctx, "users.manage", {});
  return db
    .select({ id: invites.id, email: invites.email, displayName: invites.displayName, status: invites.status, expiresAt: invites.expiresAt, createdAt: invites.createdAt })
    .from(invites)
    .where(and(eq(invites.organizationId, ctx.organizationId), eq(invites.status, "PENDING")))
    .orderBy(asc(invites.createdAt));
}

/** Public (unauthenticated) acceptance. Error messages do not reveal whether an email/token exists. */
export async function acceptInvite(db: Db, input: unknown, hash: (pw: string) => Promise<string>) {
  const data = parse(inviteAccept, input);
  const invalid = () => new AppError("INVITE_INVALID", "This invitation is invalid or has expired.");
  const [inv] = await db
    .select()
    .from(invites)
    .where(eq(invites.tokenHash, hashToken(data.token)));
  if (!inv || inv.status !== "PENDING" || inv.expiresAt.getTime() < Date.now()) throw invalid();
  const passwordHash = await hash(data.password);
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(invites)
      .set({ status: "ACCEPTED", acceptedAt: new Date() })
      .where(and(eq(invites.id, inv.id), eq(invites.status, "PENDING")))
      .returning();
    if (!claimed) throw invalid();
    let [u] = await tx.select().from(users).where(eq(users.email, inv.email));
    if (!u) {
      [u] = await tx.insert(users).values({ name: inv.displayName, email: inv.email, emailVerified: true }).returning();
      await tx.insert(accounts).values({ userId: u!.id, accountId: u!.id, providerId: "credential", password: passwordHash });
    } else {
      throw invalid(); // existing identity must sign in and be added by an admin (avoids account takeover via invite)
    }
    const [m] = await tx.insert(memberships).values({ organizationId: inv.organizationId, userId: u!.id, displayName: inv.displayName, status: "ACTIVE" }).returning();
    const grants = inv.grants as GrantInput[];
    if (grants.length) {
      await tx.insert(roleGrants).values(
        grants.map((g) => ({
          organizationId: inv.organizationId,
          membershipId: m!.id,
          roleId: g.roleId,
          siteId: g.siteId ?? null,
          departmentId: g.departmentId ?? null,
          grantedBy: inv.invitedBy,
        })),
      );
    }
    await audit(
      tx,
      { system: "invite.accept", organizationId: inv.organizationId },
      { action: "invite.accept", resourceType: "membership", resourceId: m!.id, metadata: { inviteId: inv.id } },
    );
    return { email: inv.email };
  });
}
