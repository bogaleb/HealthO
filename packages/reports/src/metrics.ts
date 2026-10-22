import { and, eq, inArray, isNotNull, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { qualified, type Db } from "@projectos/db";
import {
  appointmentTypes,
  appointments,
  credentialingCases,
  eligibilityEvaluations,
  memberships,
  payerPlans,
  payers,
  practitioners,
  professionalAuthorities,
  projects,
  providerEnrollments,
  rcmCases,
  rcmQueues,
  sites,
  tasks,
} from "@projectos/db/schema";
import type { AuthContext } from "@projectos/auth";
import { projectScopeWhere } from "@projectos/core";
import { practitionerScopeWhere } from "@projectos/credentialing";
import { siteWhere } from "@projectos/scheduling";
import { caseRef, credentialingBlockedWhere, rcmScopeWhere } from "@projectos/rcm";
import { addDays, type Permission } from "@projectos/shared";

/**
 * Phase 6 metric registry. Each metric is ONE SQL query (scoped by the caller's permissions) that returns its
 * source rows together with `count(*) over()`: the dashboard tile reads the total from that query and the
 * drill-down pages the very same query — so a tile can never disagree with its drill-down.
 */

export const FILTER_KEYS = ["siteId", "departmentId", "practitionerId", "from", "to"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const reportFilters = z
  .object({
    siteId: z.uuid().optional(),
    departmentId: z.uuid().optional(),
    practitionerId: z.uuid().optional(),
    from: iso.optional(),
    to: iso.optional(),
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, { message: "From must be on or before To", path: ["to"] });
export type ReportFilters = z.output<typeof reportFilters>;

export type Domain = "SCHEDULING" | "CREDENTIALING" | "RCM" | "PROJECTS";
export const DOMAIN_LABEL: Record<Domain, string> = { SCHEDULING: "Scheduling", CREDENTIALING: "Credentialing", RCM: "Revenue cycle", PROJECTS: "Projects" };

export interface Column {
  key: string;
  label: string;
  kind?: "text" | "date" | "instant" | "money" | "number" | "badge";
}

export interface ResolvedFilters extends ReportFilters {
  today: string;
  timezone: string;
  now: Date;
}

export interface MetricDef {
  key: string;
  label: string;
  domain: Domain;
  /** Plain-language definition shown on the tile and the report page. */
  definition: string;
  /** Tables the number is computed from. */
  source: string;
  permission: Permission;
  supports: FilterKey[];
  /** What from/to filter (if supported) — and the default window when none is given. */
  dateBasis?: { label: string; defaultFrom?: (today: string) => string; defaultTo?: (today: string) => string };
  /** "lower is better" metrics are highlighted when non-zero. */
  attention?: boolean;
  columns: Column[];
  /** Latest change in the source rows (freshness), computed in the same scope. */
  sourceUpdatedAt: (db: Db, ctx: AuthContext) => Promise<string | null>;
  rows: (db: Db, ctx: AuthContext, f: ResolvedFilters, page: { limit: number; offset: number }) => Promise<{ total: number; rows: Record<string, unknown>[] }>;
}

const total = sql<number>`count(*) over()`.mapWith(Number);
const localDate = (col: SQL | unknown, tz: SQL | string) => sql`(${col} at time zone ${tz})::date`;
const maxAt = async (db: Db, q: Promise<{ at: unknown }[]>) => {
  const [r] = await q;
  void db;
  return r?.at ? new Date(r.at as string).toISOString() : null;
};
function strip<T extends { total: number }>(rows: T[]) {
  return { total: rows[0]?.total ?? 0, rows: rows.map(({ total: _t, ...r }) => r as Record<string, unknown>) };
}
const range = (f: ResolvedFilters) => ({ from: f.from!, to: f.to! });

const ownerName = sql<
  string | null
>`(select m.display_name from memberships m where m.user_id = ${qualified(rcmCases.ownerUserId)} and m.organization_id = ${qualified(rcmCases.organizationId)})`;

// ------------------------------------------------------------------ scheduling

function apptWhere(ctx: AuthContext, f: ResolvedFilters): SQL[] {
  const w: SQL[] = [eq(appointments.organizationId, ctx.organizationId), siteWhere(ctx, "scheduling.read", appointments.siteId)];
  if (f.siteId) w.push(eq(appointments.siteId, f.siteId));
  if (f.practitionerId) w.push(eq(appointments.practitionerId, f.practitionerId));
  return w;
}
const apptCols = {
  id: appointments.id,
  startAt: appointments.startAt,
  timezone: appointments.timezone,
  provider: practitioners.displayName,
  site: sites.name,
  type: appointmentTypes.name,
  status: appointments.status,
  eligibility: appointments.eligibilityDecision,
  total,
};
const apptColumns: Column[] = [
  { key: "startAt", label: "Start", kind: "instant" },
  { key: "provider", label: "Provider" },
  { key: "site", label: "Site" },
  { key: "type", label: "Visit type" },
  { key: "status", label: "Status", kind: "badge" },
  { key: "eligibility", label: "Eligibility", kind: "badge" },
];
async function apptRows(db: Db, where: SQL[], page: { limit: number; offset: number }) {
  const rows = await db
    .select(apptCols)
    .from(appointments)
    .innerJoin(practitioners, eq(practitioners.id, appointments.practitionerId))
    .innerJoin(sites, eq(sites.id, appointments.siteId))
    .innerJoin(appointmentTypes, eq(appointmentTypes.id, appointments.appointmentTypeId))
    .where(and(...where))
    .orderBy(appointments.startAt, appointments.id)
    .limit(page.limit)
    .offset(page.offset);
  return strip(rows.map((r) => ({ ...r, startAt: r.startAt.toISOString(), link: `/scheduling/calendar?date=${r.startAt.toISOString().slice(0, 10)}` })));
}
const apptUpdated = (db: Db, ctx: AuthContext) =>
  maxAt(
    db,
    db
      .select({ at: sql`max(${appointments.updatedAt})` })
      .from(appointments)
      .where(and(eq(appointments.organizationId, ctx.organizationId), siteWhere(ctx, "scheduling.read", appointments.siteId))),
  );

const appointmentsInRange: MetricDef = {
  key: "appointments-in-range",
  label: "Appointments",
  domain: "SCHEDULING",
  definition: "Appointments (any status except Cancelled) whose start falls on the selected dates, in the appointment's own time zone. Default: today.",
  source: "appointments",
  permission: "scheduling.read",
  supports: ["siteId", "practitionerId", "from", "to"],
  dateBasis: { label: "Appointment date", defaultFrom: (t) => t, defaultTo: (t) => t },
  columns: apptColumns,
  sourceUpdatedAt: apptUpdated,
  rows: (db, ctx, f, page) => {
    const { from, to } = range(f);
    return apptRows(
      db,
      [...apptWhere(ctx, f), sql`${appointments.status} <> 'CANCELLED'`, sql`${localDate(appointments.startAt, sql`${appointments.timezone}`)} between ${from} and ${to}`],
      page,
    );
  },
};

const appointmentsNeedingAttention: MetricDef = {
  key: "appointments-needing-attention",
  label: "Appointments needing attention",
  domain: "SCHEDULING",
  definition: "Upcoming appointments saved as Pending review or flagged Needs reschedule by the eligibility re-screen (possible licensure/payer/EHR conflicts).",
  source: "appointments",
  permission: "scheduling.read",
  supports: ["siteId", "practitionerId"],
  attention: true,
  columns: apptColumns,
  sourceUpdatedAt: apptUpdated,
  rows: (db, ctx, f, page) =>
    apptRows(db, [...apptWhere(ctx, f), inArray(appointments.status, ["PENDING", "NEEDS_RESCHEDULE"]), sql`${appointments.startAt} >= ${f.now.toISOString()}::timestamptz`], page),
};

const blockedAttempts: MetricDef = {
  key: "blocked-booking-attempts",
  label: "Blocked booking attempts",
  domain: "SCHEDULING",
  definition: "Eligibility evaluations with decision BLOCK on the selected dates (default: last 7 days) — bookings the system prevented (license, payer or capacity).",
  source: "eligibility_evaluations",
  permission: "scheduling.read",
  supports: ["siteId", "practitionerId", "from", "to"],
  dateBasis: { label: "Evaluation date", defaultFrom: (t) => addDays(t, -6), defaultTo: (t) => t },
  columns: [
    { key: "evaluatedAt", label: "Evaluated", kind: "instant" },
    { key: "provider", label: "Provider" },
    { key: "site", label: "Site" },
    { key: "jurisdiction", label: "Patient location" },
    { key: "licenseStatus", label: "License", kind: "badge" },
    { key: "payerStatus", label: "Payer", kind: "badge" },
    { key: "trigger", label: "Trigger" },
  ],
  sourceUpdatedAt: (db, ctx) =>
    maxAt(
      db,
      db
        .select({ at: sql`max(${eligibilityEvaluations.evaluatedAt})` })
        .from(eligibilityEvaluations)
        .where(and(eq(eligibilityEvaluations.organizationId, ctx.organizationId), siteWhere(ctx, "scheduling.read", eligibilityEvaluations.siteId))),
    ),
  rows: async (db, ctx, f, page) => {
    const { from, to } = range(f);
    const w: SQL[] = [
      eq(eligibilityEvaluations.organizationId, ctx.organizationId),
      siteWhere(ctx, "scheduling.read", eligibilityEvaluations.siteId),
      eq(eligibilityEvaluations.decision, "BLOCK"),
      sql`${localDate(eligibilityEvaluations.evaluatedAt, f.timezone)} between ${from} and ${to}`,
    ];
    if (f.siteId) w.push(eq(eligibilityEvaluations.siteId, f.siteId));
    if (f.practitionerId) w.push(eq(eligibilityEvaluations.practitionerId, f.practitionerId));
    const rows = await db
      .select({
        id: eligibilityEvaluations.id,
        evaluatedAt: eligibilityEvaluations.evaluatedAt,
        provider: practitioners.displayName,
        site: sites.name,
        jurisdiction: eligibilityEvaluations.jurisdiction,
        licenseStatus: eligibilityEvaluations.licenseStatus,
        payerStatus: eligibilityEvaluations.payerStatus,
        trigger: eligibilityEvaluations.trigger,
        total,
      })
      .from(eligibilityEvaluations)
      .innerJoin(practitioners, eq(practitioners.id, eligibilityEvaluations.practitionerId))
      .innerJoin(sites, eq(sites.id, eligibilityEvaluations.siteId))
      .where(and(...w))
      .orderBy(sql`${eligibilityEvaluations.evaluatedAt} desc`, eligibilityEvaluations.id)
      .limit(page.limit)
      .offset(page.offset);
    return strip(rows.map((r) => ({ ...r, evaluatedAt: r.evaluatedAt.toISOString() })));
  },
};

// ------------------------------------------------------------------ credentialing

const licensesExpiring: MetricDef = {
  key: "licenses-expiring",
  label: "Licenses expiring soon",
  domain: "CREDENTIALING",
  definition: "Verified licenses/authorities whose expiry date falls in the selected window (default: today through 60 days out).",
  source: "professional_authorities",
  permission: "credentialing.read",
  supports: ["practitionerId", "siteId", "from", "to"],
  dateBasis: { label: "Expiry date", defaultFrom: (t) => t, defaultTo: (t) => addDays(t, 60) },
  attention: true,
  columns: [
    { key: "provider", label: "Provider" },
    { key: "authorityType", label: "Authority", kind: "badge" },
    { key: "jurisdiction", label: "Jurisdiction" },
    { key: "expiresOn", label: "Expires", kind: "date" },
  ],
  sourceUpdatedAt: (db, ctx) =>
    maxAt(
      db,
      db
        .select({ at: sql`max(${professionalAuthorities.updatedAt})` })
        .from(professionalAuthorities)
        .innerJoin(practitioners, eq(practitioners.id, professionalAuthorities.practitionerId))
        .where(practitionerScopeWhere(ctx)),
    ),
  rows: async (db, ctx, f, page) => {
    const { from, to } = range(f);
    const w: SQL[] = [practitionerScopeWhere(ctx), eq(professionalAuthorities.status, "VERIFIED"), sql`${professionalAuthorities.expiresOn} between ${from} and ${to}`];
    if (f.practitionerId) w.push(eq(professionalAuthorities.practitionerId, f.practitionerId));
    if (f.siteId) w.push(sql`exists (select 1 from practitioner_sites ps where ps.practitioner_id = ${qualified(practitioners.id)} and ps.site_id = ${f.siteId})`);
    const rows = await db
      .select({
        id: professionalAuthorities.id,
        practitionerId: practitioners.id,
        provider: practitioners.displayName,
        authorityType: professionalAuthorities.authorityType,
        jurisdiction: professionalAuthorities.jurisdiction,
        expiresOn: professionalAuthorities.expiresOn,
        total,
      })
      .from(professionalAuthorities)
      .innerJoin(practitioners, eq(practitioners.id, professionalAuthorities.practitionerId))
      .where(and(...w))
      .orderBy(professionalAuthorities.expiresOn, professionalAuthorities.id)
      .limit(page.limit)
      .offset(page.offset);
    return strip(rows.map((r) => ({ ...r, link: `/providers/${r.practitionerId}` })));
  },
};

const credentialingOverdue: MetricDef = {
  key: "credentialing-cases-overdue",
  label: "Overdue credentialing cases",
  domain: "CREDENTIALING",
  definition: "Credentialing cases not Completed/Cancelled whose due date is before today.",
  source: "credentialing_cases",
  permission: "credentialing.read",
  supports: ["practitionerId"],
  attention: true,
  columns: [
    { key: "title", label: "Case" },
    { key: "provider", label: "Provider" },
    { key: "caseType", label: "Type", kind: "badge" },
    { key: "dueDate", label: "Due", kind: "date" },
    { key: "status", label: "Status", kind: "badge" },
  ],
  sourceUpdatedAt: (db, ctx) =>
    maxAt(
      db,
      db
        .select({ at: sql`max(${credentialingCases.updatedAt})` })
        .from(credentialingCases)
        .innerJoin(practitioners, eq(practitioners.id, credentialingCases.practitionerId))
        .where(practitionerScopeWhere(ctx)),
    ),
  rows: async (db, ctx, f, page) => {
    const w: SQL[] = [practitionerScopeWhere(ctx), notInArray(credentialingCases.status, ["COMPLETED", "CANCELLED"]), sql`${credentialingCases.dueDate} < ${f.today}`];
    if (f.practitionerId) w.push(eq(credentialingCases.practitionerId, f.practitionerId));
    const rows = await db
      .select({
        id: credentialingCases.id,
        title: credentialingCases.title,
        provider: practitioners.displayName,
        caseType: credentialingCases.caseType,
        dueDate: credentialingCases.dueDate,
        status: credentialingCases.status,
        total,
      })
      .from(credentialingCases)
      .innerJoin(practitioners, eq(practitioners.id, credentialingCases.practitionerId))
      .where(and(...w))
      .orderBy(credentialingCases.dueDate, credentialingCases.id)
      .limit(page.limit)
      .offset(page.offset);
    return strip(rows.map((r) => ({ ...r, link: `/credentialing/cases` })));
  },
};

const enrollmentsNotReady: MetricDef = {
  key: "enrollments-not-ready",
  label: "Payer enrollments not ready",
  domain: "CREDENTIALING",
  definition: "Provider × plan × site enrollments that are not Approved-and-verified (excludes Terminated). Pending is never counted as ready.",
  source: "provider_enrollments",
  permission: "credentialing.read",
  supports: ["practitionerId", "siteId"],
  attention: true,
  columns: [
    { key: "provider", label: "Provider" },
    { key: "plan", label: "Plan" },
    { key: "site", label: "Site" },
    { key: "status", label: "Status", kind: "badge" },
    { key: "submittedOn", label: "Submitted", kind: "date" },
  ],
  sourceUpdatedAt: (db, ctx) =>
    maxAt(
      db,
      db
        .select({ at: sql`max(${providerEnrollments.updatedAt})` })
        .from(providerEnrollments)
        .innerJoin(practitioners, eq(practitioners.id, providerEnrollments.practitionerId))
        .where(practitionerScopeWhere(ctx)),
    ),
  rows: async (db, ctx, f, page) => {
    const w: SQL[] = [
      practitionerScopeWhere(ctx),
      sql`${providerEnrollments.status} <> 'TERMINATED'`,
      sql`(${providerEnrollments.status} <> 'APPROVED' or ${providerEnrollments.verifiedAt} is null)`,
    ];
    if (f.practitionerId) w.push(eq(providerEnrollments.practitionerId, f.practitionerId));
    if (f.siteId) w.push(eq(providerEnrollments.siteId, f.siteId));
    const rows = await db
      .select({
        id: providerEnrollments.id,
        practitionerId: practitioners.id,
        provider: practitioners.displayName,
        plan: payerPlans.name,
        site: sites.name,
        status: sql<string>`case when ${providerEnrollments.status} = 'APPROVED' then 'APPROVED_UNVERIFIED' else ${providerEnrollments.status} end`,
        submittedOn: providerEnrollments.submittedOn,
        total,
      })
      .from(providerEnrollments)
      .innerJoin(practitioners, eq(practitioners.id, providerEnrollments.practitionerId))
      .innerJoin(payerPlans, eq(payerPlans.id, providerEnrollments.payerPlanId))
      .innerJoin(sites, eq(sites.id, providerEnrollments.siteId))
      .where(and(...w))
      .orderBy(practitioners.displayName, providerEnrollments.id)
      .limit(page.limit)
      .offset(page.offset);
    return strip(rows.map((r) => ({ ...r, link: `/providers/${r.practitionerId}` })));
  },
};

// ------------------------------------------------------------------ RCM

const OPEN_RCM = sql`${rcmCases.status} not in ('RESOLVED','CLOSED_NO_ACTION')`;
function rcmMetric(def: Omit<MetricDef, "domain" | "permission" | "columns" | "sourceUpdatedAt" | "rows" | "source">, where: (f: ResolvedFilters) => SQL[]): MetricDef {
  return {
    ...def,
    domain: "RCM",
    permission: "rcm.read",
    source: "rcm_cases (+ rcm_queues, payers)",
    columns: [
      { key: "ref", label: "Case" },
      { key: "queue", label: "Queue" },
      { key: "payer", label: "Payer" },
      { key: "serviceDate", label: "Service date", kind: "date" },
      { key: "amountCents", label: "Balance", kind: "money" },
      { key: "status", label: "Status", kind: "badge" },
      { key: "priority", label: "Priority", kind: "badge" },
      { key: "owner", label: "Owner" },
      { key: "nextActionDue", label: "Next action due", kind: "date" },
    ],
    sourceUpdatedAt: (db, ctx) =>
      maxAt(
        db,
        db
          .select({ at: sql`max(${rcmCases.updatedAt})` })
          .from(rcmCases)
          .where(rcmScopeWhere(ctx)),
      ),
    rows: async (db, ctx, f, page) => {
      const w: SQL[] = [rcmScopeWhere(ctx), ...where(f)];
      if (f.siteId) w.push(eq(rcmCases.siteId, f.siteId));
      if (f.departmentId) w.push(eq(rcmCases.departmentId, f.departmentId));
      if (f.practitionerId) w.push(eq(rcmCases.practitionerId, f.practitionerId));
      const rows = await db
        .select({
          id: rcmCases.id,
          number: rcmCases.number,
          queue: rcmQueues.name,
          payer: payers.name,
          serviceDate: rcmCases.serviceDate,
          amountCents: rcmCases.amountCents,
          status: rcmCases.status,
          priority: rcmCases.priority,
          owner: ownerName,
          nextActionDue: rcmCases.nextActionDue,
          total,
        })
        .from(rcmCases)
        .innerJoin(rcmQueues, eq(rcmQueues.id, rcmCases.queueId))
        .innerJoin(payers, eq(payers.id, rcmCases.payerId))
        .where(and(...w))
        .orderBy(rcmCases.serviceDate, rcmCases.number)
        .limit(page.limit)
        .offset(page.offset);
      return strip(rows.map(({ number, ...r }) => ({ ...r, ref: caseRef(number), owner: r.owner ?? "Unassigned", link: `/rcm/cases/${r.id}` })));
    },
  };
}

const rcmOpen = rcmMetric(
  { key: "rcm-open", label: "Open RCM cases", definition: "RCM cases not Resolved or Closed.", supports: ["siteId", "departmentId", "practitionerId"] },
  () => [OPEN_RCM],
);
const rcmAged = rcmMetric(
  {
    key: "rcm-aged-over-90",
    label: "Open RCM cases > 90 days",
    definition: "Open RCM cases whose date of service is more than 90 days before today (high-priority aging).",
    supports: ["siteId", "departmentId", "practitionerId"],
    attention: true,
  },
  (f) => [OPEN_RCM, sql`${rcmCases.serviceDate} < ${addDays(f.today, -90)}`],
);
const rcmOverdue = rcmMetric(
  {
    key: "rcm-next-action-overdue",
    label: "RCM follow-ups overdue",
    definition: "Open RCM cases whose next-action date is before today (same definition as the queue 'Overdue' count).",
    supports: ["siteId", "departmentId", "practitionerId"],
    attention: true,
  },
  (f) => [OPEN_RCM, sql`${rcmCases.nextActionDue} < ${f.today}`],
);
const rcmUnassigned = rcmMetric(
  { key: "rcm-unassigned", label: "Unassigned RCM cases", definition: "Open RCM cases with no owner.", supports: ["siteId", "departmentId", "practitionerId"], attention: true },
  () => [OPEN_RCM, isNull(rcmCases.ownerUserId)],
);
const rcmResolved = rcmMetric(
  {
    key: "rcm-resolved",
    label: "RCM cases resolved",
    definition: "Cases moved to Resolved on the selected dates (default: last 30 days) — worklist throughput.",
    supports: ["siteId", "departmentId", "practitionerId", "from", "to"],
    dateBasis: { label: "Resolved date", defaultFrom: (t) => addDays(t, -29), defaultTo: (t) => t },
  },
  (f) => [eq(rcmCases.status, "RESOLVED"), isNotNull(rcmCases.resolvedAt), sql`${localDate(rcmCases.resolvedAt, f.timezone)} between ${f.from!} and ${f.to!}`],
);
const rcmCredBlocked = rcmMetric(
  {
    key: "rcm-credentialing-blocked",
    label: "RCM cases blocked by credentialing",
    definition: "Open RCM cases linked to a credentialing case that is not yet Completed (enrollment/licensure blockers, linked not duplicated).",
    supports: ["siteId", "departmentId", "practitionerId"],
    attention: true,
  },
  () => [credentialingBlockedWhere()],
);

// ------------------------------------------------------------------ projects

const tasksOverdue: MetricDef = {
  key: "tasks-overdue",
  label: "Overdue tasks",
  domain: "PROJECTS",
  definition: "Open tasks (not Done/Cancelled) in projects visible to you, due before today. Same definition as Home.",
  source: "tasks (+ projects)",
  permission: "projects.read",
  supports: ["siteId", "departmentId"],
  attention: true,
  columns: [
    { key: "ref", label: "Task" },
    { key: "title", label: "Title" },
    { key: "owner", label: "Owner" },
    { key: "dueDate", label: "Due", kind: "date" },
    { key: "status", label: "Status", kind: "badge" },
  ],
  sourceUpdatedAt: (db, ctx) =>
    maxAt(
      db,
      db
        .select({ at: sql`max(${tasks.updatedAt})` })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(projectScopeWhere(ctx)),
    ),
  rows: async (db, ctx, f, page) => {
    const w: SQL[] = [projectScopeWhere(ctx), isNull(tasks.deletedAt), notInArray(tasks.status, ["DONE", "CANCELLED"]), sql`${tasks.dueDate} < ${f.today}`];
    if (f.siteId) w.push(eq(projects.siteId, f.siteId));
    if (f.departmentId) w.push(eq(projects.departmentId, f.departmentId));
    const rows = await db
      .select({
        id: tasks.id,
        projectId: projects.id,
        key: projects.key,
        number: tasks.number,
        title: tasks.title,
        owner: memberships.displayName,
        dueDate: tasks.dueDate,
        status: tasks.status,
        total,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(memberships, and(eq(memberships.userId, tasks.ownerUserId), eq(memberships.organizationId, tasks.organizationId)))
      .where(and(...w))
      .orderBy(tasks.dueDate, tasks.id)
      .limit(page.limit)
      .offset(page.offset);
    return strip(rows.map(({ key, number, ...r }) => ({ ...r, ref: `${key}-${number}`, owner: r.owner ?? "Unassigned", link: `/projects/${r.projectId}/list?task=${r.id}` })));
  },
};

const projectsAtRisk: MetricDef = {
  key: "projects-at-risk",
  label: "Projects at risk / off track",
  domain: "PROJECTS",
  definition: "Active projects whose health is At risk or Off track.",
  source: "projects",
  permission: "projects.read",
  supports: ["siteId", "departmentId"],
  attention: true,
  columns: [
    { key: "key", label: "Key" },
    { key: "name", label: "Project" },
    { key: "health", label: "Health", kind: "badge" },
    { key: "dueDate", label: "Due", kind: "date" },
  ],
  sourceUpdatedAt: (db, ctx) =>
    maxAt(
      db,
      db
        .select({ at: sql`max(${projects.updatedAt})` })
        .from(projects)
        .where(projectScopeWhere(ctx)),
    ),
  rows: async (db, ctx, f, page) => {
    const w: SQL[] = [projectScopeWhere(ctx), eq(projects.status, "ACTIVE"), inArray(projects.health, ["AT_RISK", "OFF_TRACK"])];
    if (f.siteId) w.push(eq(projects.siteId, f.siteId));
    if (f.departmentId) w.push(eq(projects.departmentId, f.departmentId));
    const rows = await db
      .select({ id: projects.id, key: projects.key, name: projects.name, health: projects.health, dueDate: projects.dueDate, total })
      .from(projects)
      .where(and(...w))
      .orderBy(projects.key)
      .limit(page.limit)
      .offset(page.offset);
    return strip(rows.map((r) => ({ ...r, link: `/projects/${r.id}` })));
  },
};

export const METRICS: MetricDef[] = [
  appointmentsInRange,
  appointmentsNeedingAttention,
  blockedAttempts,
  licensesExpiring,
  credentialingOverdue,
  enrollmentsNotReady,
  rcmOpen,
  rcmAged,
  rcmOverdue,
  rcmUnassigned,
  rcmCredBlocked,
  rcmResolved,
  tasksOverdue,
  projectsAtRisk,
];
export const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));
