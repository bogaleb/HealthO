import { and, eq } from "drizzle-orm";
import type { Db } from "@projectos/db";
import { accounts, memberships, organizations, rolePermissions, roleGrants, roles, users } from "@projectos/db/schema";
import { PERMISSIONS, type Permission } from "@projectos/shared";

export const SYSTEM_ROLES: { key: string; name: string; description: string; permissions: readonly Permission[] }[] = [
  { key: "org_admin", name: "Organization Administrator", description: "Full administrative access (least-privilege roles preferred for daily work).", permissions: PERMISSIONS },
  { key: "scheduling_manager", name: "Scheduling Manager", description: "Configure and manage schedules.", permissions: ["scheduling.read", "scheduling.manage", "patients.read", "projects.read", "projects.edit"] },
  { key: "scheduler", name: "Scheduler / Front Desk", description: "Search, book and change appointments.", permissions: ["scheduling.read", "scheduling.manage", "patients.read", "projects.read"] },
  { key: "credentialing_specialist", name: "Credentialing Specialist", description: "Maintain licenses, enrollments and cases.", permissions: ["credentialing.read", "credentialing.edit", "projects.read", "projects.edit"] },
  { key: "credentialing_approver", name: "Credentialing Approver", description: "Approve verified credential evidence.", permissions: ["credentialing.read", "credentialing.approve", "projects.read"] },
  { key: "compliance_officer", name: "Compliance Officer", description: "Publish licensure policy; review audit.", permissions: ["policy.publish", "audit.read", "credentialing.read", "projects.read"] },
  { key: "rcm_supervisor", name: "Revenue Cycle Supervisor", description: "Configure queues and assign RCM work.", permissions: ["rcm.read", "rcm.edit", "projects.read", "projects.edit"] },
  { key: "rcm_analyst", name: "Billing / Follow-up Analyst", description: "Work assigned RCM cases.", permissions: ["rcm.read", "rcm.edit", "projects.read", "projects.edit"] },
  { key: "project_manager", name: "Project Manager", description: "Create projects, boards and tasks.", permissions: ["projects.read", "projects.edit"] },
  { key: "executive", name: "Executive / Quality", description: "Cross-department read-only summaries.", permissions: ["projects.read", "scheduling.read", "credentialing.read", "rcm.read"] },
  { key: "auditor", name: "Auditor", description: "Read audit events.", permissions: ["audit.read", "projects.read"] },
  { key: "read_only", name: "Read-only Observer", description: "View shared non-PHI summaries.", permissions: ["projects.read"] },
];

export async function bootstrapOrganization(db: Db, input: { name: string; slug: string; timezone?: string }) {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: input.name, slug: input.slug, timezone: input.timezone ?? "America/New_York", isSynthetic: true })
      .returning();
    const roleIds: Record<string, string> = {};
    for (const r of SYSTEM_ROLES) {
      const [row] = await tx.insert(roles).values({ organizationId: org!.id, key: r.key, name: r.name, description: r.description, isSystem: true }).returning();
      roleIds[r.key] = row!.id;
      await tx.insert(rolePermissions).values(r.permissions.map((p) => ({ organizationId: org!.id, roleId: row!.id, permission: p })));
    }
    return { org: org!, roleIds };
  });
}

/** Creates a user + credential account + membership + grants (seed/test helper; bypasses invite flow). */
export async function createMemberDirect(
  db: Db,
  input: {
    organizationId: string;
    email: string;
    displayName: string;
    passwordHash: string;
    professionalRole?: string;
    departmentId?: string | null;
    grants: { roleId: string; siteId?: string | null; departmentId?: string | null }[];
  },
) {
  return db.transaction(async (tx) => {
    const email = input.email.toLowerCase();
    let [u] = await tx.select().from(users).where(eq(users.email, email));
    if (!u) {
      [u] = await tx.insert(users).values({ name: input.displayName, email, emailVerified: true }).returning();
      await tx.insert(accounts).values({ userId: u!.id, accountId: u!.id, providerId: "credential", password: input.passwordHash });
    }
    const [m] = await tx
      .insert(memberships)
      .values({ organizationId: input.organizationId, userId: u!.id, displayName: input.displayName, professionalRole: input.professionalRole ?? null, departmentId: input.departmentId ?? null })
      .returning();
    if (input.grants.length) {
      await tx.insert(roleGrants).values(input.grants.map((g) => ({ organizationId: input.organizationId, membershipId: m!.id, roleId: g.roleId, siteId: g.siteId ?? null, departmentId: g.departmentId ?? null })));
    }
    return { userId: u!.id, membershipId: m!.id };
  });
}

export async function findOrgBySlug(db: Db, slug: string) {
  const [o] = await db.select().from(organizations).where(and(eq(organizations.slug, slug)));
  return o;
}
