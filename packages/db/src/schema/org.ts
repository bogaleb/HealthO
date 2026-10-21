import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, orgId, updatedAt, version } from "./_common";
import { users } from "./auth";

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("ACTIVE"),
  timezone: text("timezone").notNull().default("America/New_York"),
  isSynthetic: boolean("is_synthetic").notNull().default(true),
  settings: jsonb("settings_json").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: version(),
});

export const sites = pgTable(
  "sites",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    state: text("state").notNull(),
    timezone: text("timezone").notNull(),
    addressLine1: text("address_line1"),
    city: text("city"),
    postalCode: text("postal_code"),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique("sites_org_code_uq").on(t.organizationId, t.code),
    unique("sites_org_id_uq").on(t.organizationId, t.id),
    check("sites_state_len", sql`char_length(${t.state}) = 2`),
  ],
);

export const departments = pgTable(
  "departments",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    siteId: uuid("site_id"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique("departments_org_code_uq").on(t.organizationId, t.code),
    unique("departments_org_id_uq").on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.siteId], foreignColumns: [sites.organizationId, sites.id] }),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    departmentId: uuid("department_id").notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("teams_org_dept_name_uq").on(t.organizationId, t.departmentId, t.name),
    foreignKey({ columns: [t.organizationId, t.departmentId], foreignColumns: [departments.organizationId, departments.id] }),
  ],
);

/** Professional role of a staff member (e.g. Scheduler, RN) — descriptive, separate from permission roles. */
export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    displayName: text("display_name").notNull(),
    professionalRole: text("professional_role"),
    departmentId: uuid("department_id"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique("memberships_org_user_uq").on(t.organizationId, t.userId),
    unique("memberships_org_id_uq").on(t.organizationId, t.id),
    check("memberships_status_ck", sql`${t.status} in ('ACTIVE','SUSPENDED','INVITED')`),
    foreignKey({ columns: [t.organizationId, t.departmentId], foreignColumns: [departments.organizationId, departments.id] }),
  ],
);

export const roles = pgTable(
  "roles",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [unique("roles_org_key_uq").on(t.organizationId, t.key), unique("roles_org_id_uq").on(t.organizationId, t.id)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    organizationId: orgId(),
    roleId: uuid("role_id").notNull(),
    permission: text("permission").notNull(),
  },
  (t) => [
    uniqueIndex("role_permissions_pk").on(t.roleId, t.permission),
    foreignKey({ columns: [t.organizationId, t.roleId], foreignColumns: [roles.organizationId, roles.id] }).onDelete("cascade"),
  ],
);

/** Role grant to a membership, optionally constrained to one site or one department. */
export const roleGrants = pgTable(
  "role_grants",
  {
    id: id(),
    organizationId: orgId(),
    membershipId: uuid("membership_id").notNull(),
    roleId: uuid("role_id").notNull(),
    siteId: uuid("site_id"),
    departmentId: uuid("department_id"),
    grantedBy: uuid("granted_by"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }).onDelete(
      "cascade",
    ),
    foreignKey({ columns: [t.organizationId, t.roleId], foreignColumns: [roles.organizationId, roles.id] }),
    foreignKey({ columns: [t.organizationId, t.siteId], foreignColumns: [sites.organizationId, sites.id] }),
    foreignKey({ columns: [t.organizationId, t.departmentId], foreignColumns: [departments.organizationId, departments.id] }),
    check("role_grants_single_scope", sql`not (${t.siteId} is not null and ${t.departmentId} is not null)`),
    index("role_grants_membership_idx").on(t.membershipId),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    grants: jsonb("grants").notNull(),
    status: text("status").notNull().default("PENDING"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    invitedBy: uuid("invited_by").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("invites_status_ck", sql`${t.status} in ('PENDING','ACCEPTED','REVOKED','EXPIRED')`),
    index("invites_org_email_idx").on(t.organizationId, t.email),
  ],
);
