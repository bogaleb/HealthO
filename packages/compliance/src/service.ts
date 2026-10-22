import { and, asc, desc, eq, sql, type Column } from "drizzle-orm";
import { z } from "zod";
import { qualified, type Db, type DbOrTx } from "@projectos/db";
import { complianceItems, ehrConnections, licensePolicyRules, opsDrills, sites, users } from "@projectos/db/schema";
import { hasAny, type AuthContext } from "@projectos/auth";
import { audit, authorize, parse } from "@projectos/core";
import { AppError, appMode, isSyntheticMode, notFound, versionConflict, type Permission } from "@projectos/shared";
import { COMPLIANCE_CATALOG } from "./catalog";

export const READINESS_NOT_APPROVED = "NOT APPROVED FOR REAL PHI";
/** Roles whose holders must use MFA before any PHI mode (and when REQUIRE_MFA_FOR_PRIVILEGED=true). */
export const PRIVILEGED_PERMISSIONS: Permission[] = ["org.manage", "users.manage", "audit.read", "policy.publish", "integrations.manage", "compliance.manage"];

/** MFA is mandatory outside synthetic modes; in synthetic modes it is opt-in via REQUIRE_MFA_FOR_PRIVILEGED=true. */
export function mfaRequiredForPrivileged() {
  return !isSyntheticMode(appMode()) || process.env.REQUIRE_MFA_FOR_PRIVILEGED === "true";
}
export const isPrivileged = (ctx: AuthContext) => PRIVILEGED_PERMISSIONS.some((p) => hasAny(ctx, p));

/** Insert catalog items an organization does not have yet (idempotent; never overwrites recorded evidence). */
export async function ensureComplianceCatalog(db: DbOrTx, organizationId: string) {
  await db
    .insert(complianceItems)
    .values(COMPLIANCE_CATALOG.map((c, i) => ({ organizationId, ...c, sortOrder: i })))
    .onConflictDoNothing();
}

async function readGate(db: Db, ctx: AuthContext) {
  if (hasAny(ctx, "compliance.manage") || hasAny(ctx, "org.manage") || hasAny(ctx, "audit.read")) return;
  await authorize(db, ctx, "compliance.manage", "ANY", { action: "compliance.read", resourceType: "compliance" });
}

export async function listComplianceItems(db: Db, ctx: AuthContext) {
  await readGate(db, ctx);
  await ensureComplianceCatalog(db, ctx.organizationId);
  const name = (col: Column) =>
    sql<string | null>`(select m.display_name from memberships m where m.user_id = ${qualified(col)} and m.organization_id = ${qualified(complianceItems.organizationId)})`;
  return db
    .select({ item: complianceItems, submittedByName: name(complianceItems.submittedBy), approvedByName: name(complianceItems.approvedBy) })
    .from(complianceItems)
    .where(eq(complianceItems.organizationId, ctx.organizationId))
    .orderBy(asc(complianceItems.sortOrder));
}

const itemUpdate = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("UPDATE"),
    version: z.number().int(),
    status: z.enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED"]),
    notes: z.string().trim().max(1000).nullable().optional(),
  }),
  z.object({
    action: z.literal("SUBMIT_EVIDENCE"),
    version: z.number().int(),
    /** Where the evidence lives (document system path / ticket id). Never upload PHI here. */
    evidenceRef: z.string().trim().min(3).max(500),
    notes: z.string().trim().max(1000).nullable().optional(),
  }),
  z.object({ action: z.literal("APPROVE"), version: z.number().int(), notes: z.string().trim().max(1000).nullable().optional() }),
  z.object({ action: z.literal("REOPEN"), version: z.number().int(), notes: z.string().trim().min(3).max(1000) }),
]);

/**
 * Evidence workflow with dual control: the person who submits evidence cannot approve it (also a DB CHECK).
 * Approval records a reviewer's judgement about EXTERNAL evidence — the software cannot verify the documents.
 */
export async function updateComplianceItem(db: Db, ctx: AuthContext, id: string, input: unknown) {
  const d = parse(itemUpdate, input);
  await authorize(db, ctx, "compliance.manage", {}, { action: `compliance.${d.action.toLowerCase()}`, resourceType: "compliance_item", resourceId: id });
  const [item] = await db
    .select()
    .from(complianceItems)
    .where(and(eq(complianceItems.organizationId, ctx.organizationId), eq(complianceItems.id, id)));
  if (!item) throw notFound("Checklist item");
  const now = new Date();
  let set: Partial<typeof complianceItems.$inferInsert>;
  if (d.action === "UPDATE") {
    if (item.status === "APPROVED") throw new AppError("CONFLICT", "Approved items must be reopened with a reason first.");
    set = { status: d.status, notes: d.notes ?? item.notes };
  } else if (d.action === "SUBMIT_EVIDENCE") {
    if (item.status === "APPROVED") throw new AppError("CONFLICT", "Approved items must be reopened with a reason first.");
    set = { status: "EVIDENCE_SUBMITTED", evidenceRef: d.evidenceRef, notes: d.notes ?? item.notes, submittedBy: ctx.userId, submittedAt: now, approvedBy: null, approvedAt: null };
  } else if (d.action === "APPROVE") {
    if (item.status !== "EVIDENCE_SUBMITTED") throw new AppError("CONFLICT", "Only items with submitted evidence can be approved.");
    if (item.submittedBy === ctx.userId) {
      await audit(db, ctx, { action: "compliance.approve", resourceType: "compliance_item", resourceId: id, outcome: "DENY", metadata: { reason: "self_approval" } });
      throw new AppError("FORBIDDEN", "A different person must approve the evidence you submitted (dual control).");
    }
    set = { status: "APPROVED", approvedBy: ctx.userId, approvedAt: now, notes: d.notes ?? item.notes };
  } else {
    set = { status: "IN_PROGRESS", approvedBy: null, approvedAt: null, notes: d.notes };
  }
  const [r] = await db
    .update(complianceItems)
    .set({ ...set, version: d.version + 1 })
    .where(and(eq(complianceItems.id, id), eq(complianceItems.version, d.version)))
    .returning();
  if (!r) throw versionConflict();
  await audit(db, ctx, { action: `compliance.${d.action.toLowerCase()}`, resourceType: "compliance_item", resourceId: id, metadata: { key: item.key, status: r.status } });
  return r;
}

// ------------------------------------------------------------------ automated technical checks

export interface Check {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

async function lastDrill(db: Db, kind: string) {
  const [r] = await db.select().from(opsDrills).where(eq(opsDrills.kind, kind)).orderBy(desc(opsDrills.finishedAt)).limit(1);
  return r ?? null;
}

export async function technicalChecks(db: Db, organizationId: string, now = new Date()): Promise<Check[]> {
  const mode = appMode();
  const checks: Check[] = [];
  checks.push({
    key: "app_mode",
    label: "Product mode allows real PHI",
    ok: mode === "PILOT_APPROVED" || mode === "PRODUCTION_APPROVED",
    detail: `APP_MODE=${mode}. DEVELOPMENT and DEMO_SYNTHETIC never allow real PHI.`,
  });
  const priv = await db.execute<{ total: number; mfa: number }>(sql`
    select count(distinct m.user_id)::int as total, count(distinct m.user_id) filter (where u.two_factor_enabled)::int as mfa
    from memberships m join users u on u.id = m.user_id
    join role_grants g on g.membership_id = m.id and g.organization_id = m.organization_id
    join role_permissions rp on rp.role_id = g.role_id and rp.organization_id = g.organization_id
    where m.organization_id = ${organizationId} and m.status = 'ACTIVE' and rp.permission in ${PRIVILEGED_PERMISSIONS}`);
  const p = priv[0] ?? { total: 0, mfa: 0 };
  checks.push({
    key: "mfa_privileged",
    label: "MFA on every privileged account",
    ok: p.total > 0 && p.mfa === p.total && mfaRequiredForPrivileged(),
    detail: `${p.mfa}/${p.total} privileged users have MFA; enforcement ${mfaRequiredForPrivileged() ? "ON" : "OFF (synthetic mode, REQUIRE_MFA_FOR_PRIVILEGED not set)"}.`,
  });
  const https = (process.env.BETTER_AUTH_URL ?? "").startsWith("https://");
  checks.push({ key: "tls", label: "Served over HTTPS", ok: https, detail: https ? "BETTER_AUTH_URL uses https." : "BETTER_AUTH_URL is not https (local development)." });
  const secretOk = (process.env.BETTER_AUTH_SECRET ?? "").length >= 32 && !/replace-with/.test(process.env.BETTER_AUTH_SECRET ?? "");
  checks.push({ key: "secret", label: "Non-default auth secret", ok: secretOk, detail: secretOk ? "Set and not the example value." : "Missing or example value." });
  const restore = await lastDrill(db, "BACKUP_RESTORE");
  const restoreOk = !!restore && restore.status === "PASS" && now.getTime() - restore.finishedAt.getTime() < 7 * 86_400_000;
  checks.push({
    key: "restore_drill",
    label: "Backup restore drill passed in the last 7 days",
    ok: restoreOk,
    detail: restore ? `Last drill ${restore.status} at ${restore.finishedAt.toISOString()}.` : "No restore drill recorded (run pnpm ops:restore-drill).",
  });
  const rehearsal = await lastDrill(db, "CLINIC_DAY_REHEARSAL");
  checks.push({
    key: "rehearsal",
    label: "Clinic-day rehearsal passed in the last 30 days",
    ok: !!rehearsal && rehearsal.status === "PASS" && now.getTime() - rehearsal.finishedAt.getTime() < 30 * 86_400_000,
    detail: rehearsal ? `Last rehearsal ${rehearsal.status} at ${rehearsal.finishedAt.toISOString()}.` : "No rehearsal recorded (run pnpm ops:rehearsal).",
  });
  // Phase 8 release-validation drills (each must have passed within 30 days of a release decision).
  for (const [kind, key, label, cmd] of [
    ["LOAD_TEST", "load_test", "Concurrency load test + performance budget passed (30 days)", "pnpm ops:load-test"],
    ["CLEAN_DEPLOY_RESTORE", "clean_deploy_restore", "Restore into a clean deployment passed (30 days)", "pnpm ops:clean-restore"],
    ["MIGRATION_ROLLBACK", "migration_rollback", "Migration failure → automatic rollback rehearsed (30 days)", "pnpm ops:migration-drill"],
  ] as const) {
    const d = await lastDrill(db, kind);
    checks.push({
      key,
      label,
      ok: !!d && d.status === "PASS" && now.getTime() - d.finishedAt.getTime() < 30 * 86_400_000,
      detail: d ? `Last run ${d.status} at ${d.finishedAt.toISOString()}.` : `Not recorded (run ${cmd}).`,
    });
  }
  const [demoRules] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(licensePolicyRules)
    .where(and(eq(licensePolicyRules.organizationId, organizationId), eq(licensePolicyRules.status, "APPROVED"), eq(licensePolicyRules.isDemo, true)));
  checks.push({
    key: "no_demo_rules",
    label: "No DEMO licensure rules in force",
    ok: (demoRules?.n ?? 0) === 0,
    detail: `${demoRules?.n ?? 0} approved DEMO (not verified law) rules.`,
  });
  const ehrSites = await db
    .select({ code: sites.code, mode: sites.ehrSyncMode, vendor: ehrConnections.vendor })
    .from(sites)
    .leftJoin(ehrConnections, eq(ehrConnections.siteId, sites.id))
    .where(and(eq(sites.organizationId, organizationId), eq(sites.active, true)));
  // A site is decided only as READ_ONLY / STANDALONE_APPROVED, or EHR_MASTER through a VERIFIED real vendor connection.
  // Neither the synthetic simulator nor an unverified vendor qualifies, so in this build EHR_MASTER sites always fail here.
  const realVendor = (v: string | null) => !!v && v !== "SYNTHETIC_SIMULATOR" && v !== "UNVERIFIED_VENDOR";
  const bad = ehrSites.filter((s) => !(s.mode === "READ_ONLY" || s.mode === "STANDALONE_APPROVED" || (s.mode === "EHR_MASTER" && realVendor(s.vendor))));
  checks.push({
    key: "source_of_truth",
    label: "Every site has a real source-of-truth decision",
    ok: bad.length === 0,
    detail: bad.length
      ? `Not ready: ${bad.map((s) => `${s.code} (${s.mode}${s.vendor === "SYNTHETIC_SIMULATOR" ? ", synthetic simulator" : ""})`).join(", ")}. A real vendor connection must be verified first.`
      : "All sites decided.",
  });
  const dead = await db.execute<{ n: number }>(
    sql`select (select count(*) from jobs where status = 'DEAD') + (select count(*) from outbox_events where status = 'DEAD' and organization_id = ${organizationId}) as n`,
  );
  checks.push({ key: "no_dead_letters", label: "No dead-lettered jobs or outbox events", ok: Number(dead[0]?.n ?? 0) === 0, detail: `${Number(dead[0]?.n ?? 0)} dead item(s).` });
  const trig = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from pg_trigger where tgname in ('audit_events_no_update','audit_no_update','audit_events_append_only')`,
  );
  checks.push({
    key: "audit_append_only",
    label: "Audit log append-only in the database",
    ok: Number(trig[0]?.n ?? 0) > 0,
    detail: Number(trig[0]?.n ?? 0) > 0 ? "Trigger present." : "Audit trigger missing!",
  });
  return checks;
}

/** Overall verdict. Default and synthetic modes: NOT APPROVED FOR REAL PHI. Never says "compliant". */
export async function getReadiness(db: Db, ctx: AuthContext, now = new Date()) {
  await readGate(db, ctx);
  await ensureComplianceCatalog(db, ctx.organizationId);
  const items = await db.select().from(complianceItems).where(eq(complianceItems.organizationId, ctx.organizationId)).orderBy(asc(complianceItems.sortOrder));
  const checks = await technicalChecks(db, ctx.organizationId, now);
  const open = items.filter((i) => i.critical && i.status !== "APPROVED");
  const failing = checks.filter((c) => !c.ok);
  const eligible = open.length === 0 && failing.length === 0;
  return {
    computedAt: now.toISOString(),
    verdict: eligible ? "ELIGIBLE FOR SPONSOR GO-LIVE DECISION" : READINESS_NOT_APPROVED,
    approvedForRealPhi: false as const,
    note: "Tracking evidence here is not proof of compliance. A go-live needs the executive sponsor's signed decision outside this software.",
    counts: {
      total: items.length,
      approved: items.filter((i) => i.status === "APPROVED").length,
      submitted: items.filter((i) => i.status === "EVIDENCE_SUBMITTED").length,
      blocked: items.filter((i) => i.status === "BLOCKED").length,
      notStarted: items.filter((i) => i.status === "NOT_STARTED").length,
      openCritical: open.length,
      checksFailing: failing.length,
    },
    checks,
    drills: await db.select().from(opsDrills).orderBy(desc(opsDrills.finishedAt)).limit(10),
  };
}

/** Recorded operational drills (append-only `ops_drills`). Phase 8 added the release-validation kinds. */
export type DrillKind = "BACKUP_RESTORE" | "CLINIC_DAY_REHEARSAL" | "DOWNTIME_PRINT" | "LOAD_TEST" | "MIGRATION_ROLLBACK" | "CLEAN_DEPLOY_RESTORE";

export async function recordDrill(
  db: DbOrTx,
  d: {
    organizationId: string | null;
    kind: DrillKind;
    status: "PASS" | "FAIL";
    startedAt: Date;
    summary: object;
    runBy: string;
  },
) {
  const [r] = await db
    .insert(opsDrills)
    .values({ ...d, finishedAt: new Date() })
    .returning();
  return r!;
}

/** Privileged users missing MFA (for the enforcement redirect and the admin list). */
export async function usersMissingMfa(db: Db, organizationId: string) {
  const rows = await db.execute<{ user_id: string; display_name: string }>(sql`
    select distinct m.user_id, m.display_name from memberships m join users u on u.id = m.user_id
    join role_grants g on g.membership_id = m.id and g.organization_id = m.organization_id
    join role_permissions rp on rp.role_id = g.role_id and rp.organization_id = g.organization_id
    where m.organization_id = ${organizationId} and m.status = 'ACTIVE' and rp.permission in ${PRIVILEGED_PERMISSIONS} and not u.two_factor_enabled
    order by m.display_name`);
  return rows.map((r) => ({ userId: r.user_id, displayName: r.display_name }));
}

export async function userHasMfa(db: Db, userId: string) {
  const [u] = await db.select({ on: users.twoFactorEnabled }).from(users).where(eq(users.id, userId));
  return !!u?.on;
}
