import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgId, updatedAt, version } from "./_common";
import { organizations, sites } from "./org";
import { users } from "./auth";
import { tasks } from "./projects";

// All rows here are SYNTHETIC in demo modes. License numbers are never stored in full (last 4 only).

export const specialties = pgTable(
  "specialties",
  { id: id(), organizationId: orgId().references(() => organizations.id), code: text("code").notNull(), name: text("name").notNull(), createdAt: createdAt() },
  (t) => [unique("specialties_org_code_uq").on(t.organizationId, t.code), unique("specialties_org_id_uq").on(t.organizationId, t.id)],
);

export const services = pgTable(
  "services",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique("services_org_code_uq").on(t.organizationId, t.code), unique("services_org_id_uq").on(t.organizationId, t.id)],
);

export const practitioners = pgTable(
  "practitioners",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    displayName: text("display_name").notNull(),
    profession: text("profession").notNull(),
    npi: text("npi"),
    userId: uuid("user_id").references(() => users.id),
    physicalState: text("physical_state"),
    telehealthCapable: boolean("telehealth_capable").notNull().default(false),
    languages: text("languages").array().notNull().default(sql`'{}'::text[]`),
    active: boolean("active").notNull().default(true),
    isSynthetic: boolean("is_synthetic").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique("practitioners_org_id_uq").on(t.organizationId, t.id),
    index("practitioners_org_profession_idx").on(t.organizationId, t.profession),
    check("practitioners_profession_ck", sql`${t.profession} in ('PHYSICIAN','APRN','RN','LPN','PSYCHOLOGIST','LCSW','LPC','PA')`),
  ],
);

export const practitionerSites = pgTable(
  "practitioner_sites",
  { organizationId: orgId(), practitionerId: uuid("practitioner_id").notNull(), siteId: uuid("site_id").notNull() },
  (t) => [
    unique("practitioner_sites_uq").on(t.practitionerId, t.siteId),
    foreignKey({ columns: [t.organizationId, t.practitionerId], foreignColumns: [practitioners.organizationId, practitioners.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.organizationId, t.siteId], foreignColumns: [sites.organizationId, sites.id] }),
  ],
);

export const practitionerSpecialties = pgTable(
  "practitioner_specialties",
  { organizationId: orgId(), practitionerId: uuid("practitioner_id").notNull(), specialtyId: uuid("specialty_id").notNull() },
  (t) => [
    unique("practitioner_specialties_uq").on(t.practitionerId, t.specialtyId),
    foreignKey({ columns: [t.organizationId, t.practitionerId], foreignColumns: [practitioners.organizationId, practitioners.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.organizationId, t.specialtyId], foreignColumns: [specialties.organizationId, specialties.id] }),
  ],
);

export const practitionerServices = pgTable(
  "practitioner_services",
  { organizationId: orgId(), practitionerId: uuid("practitioner_id").notNull(), serviceId: uuid("service_id").notNull() },
  (t) => [
    unique("practitioner_services_uq").on(t.practitionerId, t.serviceId),
    foreignKey({ columns: [t.organizationId, t.practitionerId], foreignColumns: [practitioners.organizationId, practitioners.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.organizationId, t.serviceId], foreignColumns: [services.organizationId, services.id] }),
  ],
);

export const professionalAuthorities = pgTable(
  "professional_authorities",
  {
    id: id(),
    organizationId: orgId(),
    practitionerId: uuid("practitioner_id").notNull(),
    authorityType: text("authority_type").notNull(),
    profession: text("profession").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    homeState: text("home_state"),
    licenseNumberLast4: text("license_number_last4"),
    issuingAuthority: text("issuing_authority"),
    effectiveOn: date("effective_on").notNull(),
    expiresOn: date("expires_on"),
    restrictions: text("restrictions"),
    status: text("status").notNull().default("DRAFT"),
    submittedBy: uuid("submitted_by"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    nextReviewOn: date("next_review_on"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique("authorities_org_id_uq").on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.practitionerId], foreignColumns: [practitioners.organizationId, practitioners.id] }).onDelete("cascade"),
    index("authorities_org_juris_prof_idx").on(t.organizationId, t.jurisdiction, t.profession, t.effectiveOn),
    index("authorities_org_status_exp_idx").on(t.organizationId, t.status, t.expiresOn),
    check("authorities_dates_ck", sql`${t.expiresOn} is null or ${t.expiresOn} >= ${t.effectiveOn}`),
    check("authorities_status_ck", sql`${t.status} in ('DRAFT','SUBMITTED','VERIFIED','REJECTED','SUSPENDED','REVOKED','EXPIRED')`),
    check(
      "authorities_type_ck",
      sql`${t.authorityType} in ('STATE_LICENSE','MULTISTATE_LICENSE','APIT','TEMPORARY_PERMIT','DOCUMENTED_EXEMPTION','COMPACT_MEMBERSHIP_CLAIM')`,
    ),
    check("authorities_last4_ck", sql`${t.licenseNumberLast4} is null or char_length(${t.licenseNumberLast4}) <= 4`),
    check("authorities_verified_has_reviewer_ck", sql`${t.status} <> 'VERIFIED' or (${t.verifiedBy} is not null and ${t.verifiedAt} is not null)`),
  ],
);

/** Immutable verification history (append-only by trigger). */
export const authorityVerifications = pgTable(
  "authority_verifications",
  {
    id: id(),
    organizationId: orgId(),
    authorityId: uuid("authority_id").notNull(),
    action: text("action").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorUserId: uuid("actor_user_id"),
    sourceName: text("source_name"),
    sourceUrl: text("source_url"),
    verifiedOn: date("verified_on"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.authorityId], foreignColumns: [professionalAuthorities.organizationId, professionalAuthorities.id] }).onDelete("cascade"),
    index("authority_verifications_auth_idx").on(t.authorityId, t.createdAt),
  ],
);

export const licensePolicyRules = pgTable(
  "license_policy_rules",
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    ruleKey: text("rule_key").notNull(),
    ruleVersion: text("rule_version").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    profession: text("profession").notNull(),
    serviceCategory: text("service_category"),
    modality: text("modality").notNull(),
    authorizationBasis: text("authorization_basis").array().notNull(),
    acceptedHomeStates: text("accepted_home_states").array().notNull().default(sql`'{}'::text[]`),
    providerStates: text("provider_states").array().notNull().default(sql`'{}'::text[]`),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    nextReviewOn: date("next_review_on").notNull(),
    sourceUrl: text("source_url"),
    sourceSummary: text("source_summary").notNull(),
    isDemo: boolean("is_demo").notNull().default(true),
    status: text("status").notNull().default("DRAFT"),
    createdBy: uuid("created_by").notNull(),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalReason: text("approval_reason"),
    retiredBy: uuid("retired_by"),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    supersedesId: uuid("supersedes_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("rules_org_key_version_uq").on(t.organizationId, t.ruleKey, t.ruleVersion),
    index("rules_lookup_idx").on(t.organizationId, t.jurisdiction, t.profession, t.modality, t.status),
    check("rules_status_ck", sql`${t.status} in ('DRAFT','APPROVED','RETIRED')`),
    check("rules_modality_ck", sql`${t.modality} in ('IN_PERSON','VIDEO','AUDIO_ONLY')`),
    check("rules_dates_ck", sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`),
    check("rules_basis_nonempty_ck", sql`cardinality(${t.authorizationBasis}) > 0`),
    check("rules_basis_no_claims_ck", sql`not ('COMPACT_MEMBERSHIP_CLAIM' = any(${t.authorizationBasis}))`),
    check("rules_approved_meta_ck", sql`${t.status} <> 'APPROVED' or (${t.approvedBy} is not null and ${t.approvedAt} is not null and ${t.approvalReason} is not null)`),
  ],
);

export const payers = pgTable(
  "payers",
  { id: id(), organizationId: orgId().references(() => organizations.id), code: text("code").notNull(), name: text("name").notNull(), createdAt: createdAt() },
  (t) => [unique("payers_org_code_uq").on(t.organizationId, t.code), unique("payers_org_id_uq").on(t.organizationId, t.id)],
);

export const payerPlans = pgTable(
  "payer_plans",
  {
    id: id(),
    organizationId: orgId(),
    payerId: uuid("payer_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    requiresEnrollment: boolean("requires_enrollment").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("payer_plans_org_code_uq").on(t.organizationId, t.payerId, t.code),
    unique("payer_plans_org_id_uq").on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.payerId], foreignColumns: [payers.organizationId, payers.id] }),
  ],
);

export const providerEnrollments = pgTable(
  "provider_enrollments",
  {
    id: id(),
    organizationId: orgId(),
    practitionerId: uuid("practitioner_id").notNull(),
    payerPlanId: uuid("payer_plan_id").notNull(),
    siteId: uuid("site_id").notNull(),
    status: text("status").notNull().default("NOT_STARTED"),
    submittedOn: date("submitted_on"),
    approvedOn: date("approved_on"),
    effectiveOn: date("effective_on"),
    terminatedOn: date("terminated_on"),
    statusSetBy: uuid("status_set_by"),
    verifiedBy: uuid("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationSource: text("verification_source"),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique("enrollments_uq").on(t.organizationId, t.practitionerId, t.payerPlanId, t.siteId),
    unique("enrollments_org_id_uq").on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.practitionerId], foreignColumns: [practitioners.organizationId, practitioners.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.organizationId, t.payerPlanId], foreignColumns: [payerPlans.organizationId, payerPlans.id] }),
    foreignKey({ columns: [t.organizationId, t.siteId], foreignColumns: [sites.organizationId, sites.id] }),
    check("enrollments_status_ck", sql`${t.status} in ('NOT_STARTED','SUBMITTED','AWAITING_INFO','APPROVED','DENIED','TERMINATED')`),
    check("enrollments_approved_dates_ck", sql`${t.status} <> 'APPROVED' or (${t.approvedOn} is not null and ${t.effectiveOn} is not null)`),
  ],
);

export const credentialingCases = pgTable(
  "credentialing_cases",
  {
    id: id(),
    organizationId: orgId(),
    practitionerId: uuid("practitioner_id").notNull(),
    caseType: text("case_type").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("OPEN"),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    dueDate: date("due_date"),
    nextAction: text("next_action"),
    authorityId: uuid("authority_id"),
    enrollmentId: uuid("enrollment_id"),
    taskId: uuid("task_id"),
    createdBy: uuid("created_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique("cases_org_id_uq").on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.practitionerId], foreignColumns: [practitioners.organizationId, practitioners.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.organizationId, t.authorityId], foreignColumns: [professionalAuthorities.organizationId, professionalAuthorities.id] }),
    foreignKey({ columns: [t.organizationId, t.enrollmentId], foreignColumns: [providerEnrollments.organizationId, providerEnrollments.id] }),
    foreignKey({ columns: [t.organizationId, t.taskId], foreignColumns: [tasks.organizationId, tasks.id] }),
    index("cases_org_status_due_idx").on(t.organizationId, t.status, t.dueDate),
    check("cases_status_ck", sql`${t.status} in ('OPEN','IN_PROGRESS','WAITING_EXTERNAL','COMPLETED','CANCELLED')`),
    check(
      "cases_type_ck",
      sql`${t.caseType} in ('INITIAL_CREDENTIALING','RECREDENTIALING','LICENSE_NEW_STATE','LICENSE_RENEWAL','PAYER_ENROLLMENT')`,
    ),
  ],
);

/** One renewal task per authority × threshold × expiry date (idempotency key for the deadline job). */
export const credentialDeadlineNotices = pgTable(
  "credential_deadline_notices",
  {
    id: id(),
    organizationId: orgId(),
    authorityId: uuid("authority_id").notNull(),
    thresholdDays: text("threshold_days").notNull(),
    expiresOn: date("expires_on").notNull(),
    taskId: uuid("task_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("deadline_notices_uq").on(t.organizationId, t.authorityId, t.thresholdDays, t.expiresOn),
    foreignKey({ columns: [t.organizationId, t.authorityId], foreignColumns: [professionalAuthorities.organizationId, professionalAuthorities.id] }).onDelete("cascade"),
  ],
);

