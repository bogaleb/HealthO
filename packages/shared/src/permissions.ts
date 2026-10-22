/** Canonical permission catalog. Roles are stored in the DB but may only reference these keys. */
export const PERMISSIONS = [
  "org.manage",
  "users.manage",
  "sites.manage",
  "scheduling.read",
  "scheduling.manage",
  "scheduling.configure",
  "patients.read",
  "credentialing.read",
  "credentialing.edit",
  "credentialing.approve",
  "rcm.read",
  "rcm.edit",
  "rcm.manage",
  "projects.read",
  "projects.edit",
  "audit.read",
  "policy.publish",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "org.manage": "Manage organization settings and role definitions",
  "users.manage": "Invite staff, assign roles, deactivate memberships",
  "sites.manage": "Create and edit sites and departments",
  "scheduling.read": "View schedules",
  "scheduling.manage": "Book, change and cancel appointments",
  "scheduling.configure": "Configure appointment types, rooms, working hours and time off",
  "patients.read": "View patient records (minimum necessary)",
  "credentialing.read": "View provider credentialing records",
  "credentialing.edit": "Edit credentialing evidence and cases",
  "credentialing.approve": "Approve verified credential evidence",
  "rcm.read": "View revenue-cycle work queues",
  "rcm.edit": "Work revenue-cycle cases (record follow-ups, claim unassigned cases)",
  "rcm.manage": "Configure RCM queues, assign/bulk-assign work and undo assignments",
  "projects.read": "View projects and tasks",
  "projects.edit": "Create and edit projects and tasks",
  "audit.read": "Read audit events",
  "policy.publish": "Publish licensure policy rules",
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Permissions that only an org-wide grant may carry (no site/department scoping). */
export const ORG_WIDE_ONLY: readonly Permission[] = ["org.manage", "users.manage", "audit.read", "policy.publish"];
