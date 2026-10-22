import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgId, updatedAt, version } from "./_common";
import { organizations } from "./org";
import { users } from "./auth";

/**
 * Phase 7 PHI-readiness evidence checklist. Tracking evidence here is NOT proof of compliance: approval means a named,
 * independent reviewer recorded where the external evidence lives. Default verdict: NOT APPROVED FOR REAL PHI.
 */
export const complianceItems = pgTable(
  "compliance_items",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    key: text("key").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    requirement: text("requirement").notNull(),
    ownerRole: text("owner_role").notNull(),
    critical: boolean("critical").notNull().default(true),
    /** Item can only be satisfied outside the software (signature, contract, training…). */
    external: boolean("external").notNull().default(true),
    status: text("status").notNull().default("NOT_STARTED"),
    evidenceRef: text("evidence_ref"),
    notes: text("notes"),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique("compliance_items_org_key_uq").on(t.organizationId, t.key),
    check("compliance_items_status_ck", sql`${t.status} in ('NOT_STARTED','IN_PROGRESS','EVIDENCE_SUBMITTED','BLOCKED','APPROVED')`),
    // Dual control enforced in the database: approval needs submitted evidence and a different person.
    check(
      "compliance_items_approval_ck",
      sql`${t.status} <> 'APPROVED' or (${t.approvedBy} is not null and ${t.submittedBy} is not null and ${t.approvedBy} <> ${t.submittedBy} and ${t.evidenceRef} is not null)`,
    ),
  ],
);

/** Operational drills (backup/restore, clinic-day rehearsal, downtime) with their measured outcome. */
export const opsDrills = pgTable(
  "ops_drills",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    summary: jsonb("summary").notNull().default({}),
    runBy: text("run_by").notNull(),
  },
  (t) => [
    index("ops_drills_kind_idx").on(t.kind, t.finishedAt),
    check("ops_drills_kind_ck", sql`${t.kind} in ('BACKUP_RESTORE','CLINIC_DAY_REHEARSAL','DOWNTIME_PRINT','LOAD_TEST','MIGRATION_ROLLBACK','CLEAN_DEPLOY_RESTORE')`),
    check("ops_drills_status_ck", sql`${t.status} in ('PASS','FAIL')`),
  ],
);
