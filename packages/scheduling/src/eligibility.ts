import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@projectos/db";
import {
  appointmentTypes,
  eligibilityEvaluations,
  licensePolicyRules,
  payerPlans,
  practitioners,
  professionalAuthorities,
  providerEnrollments,
  services,
  sites,
} from "@projectos/db/schema";
import type { AuthContext } from "@projectos/auth";
import {
  evaluateLicenseReadiness,
  evaluatePayerReadiness,
  type AuthorityFact,
  type EnrollmentFact,
  type LicenseResult,
  type PayerResult,
  type PlanFact,
  type RuleFact,
} from "@projectos/credentialing/readiness";
import {
  AppError,
  CATEGORY_META,
  EVALUATION_TTL_MINUTES,
  localDate,
  type AuthorityType,
  type EligibilityCategory,
  type EligibilityDecision,
  type EligibilityFlag,
  type Modality,
  type Profession,
} from "@projectos/shared";
import { UNAVAILABLE_MESSAGE, type Unavailable } from "./slots";

/* ===================================== pure core ===================================== */

export type EhrMode = "DEMO" | "STANDALONE_APPROVED" | "EHR_MASTER" | "READ_ONLY";
export type LocationStatus = "PROPOSED" | "VERIFIED" | "UNKNOWN";

export interface EligibilityFacts {
  profession: Profession;
  practitionerPhysicalState: string | null;
  telehealthCapable: boolean;
  site: { id: string; state: string; timezone: string; ehrSyncMode: EhrMode; ehrLastSyncedAt: Date | null; ehrFreshnessMinutes: number };
  modality: Modality;
  serviceCategory: string | null;
  startAt: Date;
  patientLocationState: string | null;
  patientLocationStatus: LocationStatus;
  rules: RuleFact[];
  authorities: AuthorityFact[];
  /** null = self-pay / no plan selected. */
  payer: { plan: PlanFact; enrollments: EnrollmentFact[]; practitionerId: string } | null;
  /** null = capacity not part of this evaluation (e.g. search rows; the DB constraint is the final word). */
  capacity: { ok: true } | { ok: false; reason: Unavailable } | null;
  now: Date;
}

export interface EligibilityResult {
  decision: EligibilityDecision;
  canConfirm: boolean;
  summary: string;
  flags: EligibilityFlag[];
  jurisdiction: string | null;
  patientLocationStatus: LocationStatus;
  providerLocationState: string | null;
  licenseStatus: LicenseResult["status"] | "NOT_EVALUATED";
  payerStatus: PayerResult["status"];
  ehrMode: EhrMode;
  evidenceIds: string[];
  missingEvidenceCodes: string[];
  policyRuleId: string | null;
  policyVersion: string | null;
  isDemoPolicy: boolean;
  ruleEffectiveDate: string | null;
  nextRequiredReviewAt: string | null;
  validForInstant: string;
  evaluatedAt: string;
  expiresAt: string;
}

const flag = (category: EligibilityCategory | "INFO", severity: EligibilityFlag["severity"], code: string, message: string, evidenceId?: string): EligibilityFlag => ({
  code,
  category,
  severity,
  message,
  ...(category !== "INFO" && severity !== "INFO" ? { remediation: CATEGORY_META[category].remediation } : {}),
  ...(evidenceId ? { evidenceId } : {}),
});

const minDate = (...ds: (string | null | undefined)[]) => ds.filter((d): d is string => !!d).sort()[0] ?? null;

/**
 * The single deterministic eligibility decision (no DB, no clock, no AI). Fail-closed:
 *  - jurisdiction = where the patient physically is at visit time (the site for in-person visits);
 *  - unknown location, unverified/expired evidence, missing or stale policy → REVIEW or BLOCK, never ALLOW;
 *  - license, payer, EHR source-of-truth and capacity are separate dimensions with separate flags.
 */
export function decideEligibility(f: EligibilityFacts): EligibilityResult {
  const flags: EligibilityFlag[] = [];
  const telehealth = f.modality !== "IN_PERSON";
  const date = localDate(f.startAt, f.site.timezone);
  const asOf = localDate(f.now, f.site.timezone);

  // ---- patient location at visit time ----
  let jurisdiction: string | null;
  let locStatus: LocationStatus = f.patientLocationStatus;
  if (!telehealth) {
    jurisdiction = f.site.state;
    if (f.patientLocationState && f.patientLocationState !== f.site.state) {
      flags.push(flag("LOCATION_UNKNOWN", "REVIEW", "LOCATION_MISMATCH", `In-person visit at a ${f.site.state} site but patient location recorded as ${f.patientLocationState}.`));
    }
    if (!f.patientLocationState) locStatus = "PROPOSED";
  } else if (!f.patientLocationState || f.patientLocationStatus === "UNKNOWN") {
    jurisdiction = null;
    locStatus = "UNKNOWN";
    flags.push(flag("LOCATION_UNKNOWN", "REVIEW", "LOCATION_UNKNOWN", "Needs verification — patient's location at the time of the visit is not recorded."));
  } else {
    jurisdiction = f.patientLocationState;
  }
  const providerLocationState = telehealth ? f.practitionerPhysicalState : f.site.state;

  // ---- telehealth capability ----
  if (telehealth && !f.telehealthCapable) flags.push(flag("SCHEDULE_UNAVAILABLE", "BLOCK", "PROVIDER_NOT_TELEHEALTH", "Provider is not set up for telehealth visits."));

  // ---- license (reuses the Phase 3 evaluator: same answer as the readiness matrix) ----
  let license: LicenseResult | null = null;
  let rule: RuleFact | undefined;
  if (jurisdiction) {
    license = evaluateLicenseReadiness(
      { profession: f.profession, jurisdiction, modality: f.modality, date, serviceCategory: f.serviceCategory, providerPhysicalState: providerLocationState, asOf },
      f.rules,
      f.authorities,
    );
    rule = f.rules.find((r) => r.id === license!.ruleId);
    for (const r of license.reasons) {
      const cat: EligibilityCategory | "INFO" = r.severity === "BLOCK" ? "LICENSE_BLOCKED" : r.severity === "REVIEW" ? "LICENSE_REVIEW" : "INFO";
      flags.push(flag(cat, r.severity, r.code, r.message, r.evidenceId));
    }
  }

  // ---- payer (independent of license) ----
  let payer: PayerResult;
  if (f.payer) {
    payer = evaluatePayerReadiness({ practitionerId: f.payer.practitionerId, siteId: f.site.id, date }, f.payer.plan, f.payer.enrollments);
    for (const r of payer.reasons) flags.push(flag(r.severity === "INFO" ? "INFO" : "PAYER_NOT_READY", r.severity, r.code, r.message, r.evidenceId));
  } else {
    payer = { status: "NOT_REQUIRED", reasons: [], evidenceIds: [] };
    flags.push(flag("INFO", "INFO", "PAYER_SELF_PAY", "No payer plan selected (self-pay / not specified)."));
  }

  // ---- EHR source of truth (ADR-0003). The EHR adapter is a stub: never claim an external confirmation. ----
  const mode = f.site.ehrSyncMode;
  if (mode === "READ_ONLY") {
    flags.push(flag("EHR_STALE", "BLOCK", "EHR_READ_ONLY", "This site's schedule is read-only here; appointments are made in the EHR."));
  } else if (mode === "EHR_MASTER") {
    const ageMin = f.site.ehrLastSyncedAt ? (f.now.getTime() - f.site.ehrLastSyncedAt.getTime()) / 60_000 : Infinity;
    flags.push(
      ageMin > f.site.ehrFreshnessMinutes
        ? flag(
            "EHR_STALE",
            "REVIEW",
            "EHR_STALE",
            f.site.ehrLastSyncedAt
              ? `EHR master schedule last synchronized ${Math.round(ageMin)} min ago (limit ${f.site.ehrFreshnessMinutes}).`
              : "EHR master schedule has never synchronized.",
          )
        : flag("EHR_STALE", "REVIEW", "EHR_WRITE_NOT_CONNECTED", "The EHR is the master schedule and no EHR write connection exists; confirm in the EHR."),
    );
  } else if (mode === "DEMO") {
    flags.push(flag("INFO", "INFO", "SYNTHETIC_DEMO_SITE", "Synthetic demo site — not an authoritative schedule."));
  }

  // ---- capacity / schedule ----
  if (f.capacity && !f.capacity.ok) {
    const conflict = f.capacity.reason === "PROVIDER_BUSY" || f.capacity.reason === "NO_ROOM";
    flags.push(flag(conflict ? "CAPACITY_CONFLICT" : "SCHEDULE_UNAVAILABLE", "BLOCK", f.capacity.reason, UNAVAILABLE_MESSAGE[f.capacity.reason]));
  }

  const decision: EligibilityDecision = flags.some((x) => x.severity === "BLOCK") ? "BLOCK" : flags.some((x) => x.severity === "REVIEW") ? "REVIEW" : "ALLOW";
  const blocking = flags.filter((x) => x.severity !== "INFO");
  const evidenceIds = [...new Set([...(license?.evidenceIds ?? []), ...payer.evidenceIds])];
  const missingEvidenceCodes = [
    ...new Set(blocking.filter((x) => ["LICENSE_REVIEW", "LICENSE_BLOCKED", "PAYER_NOT_READY", "LOCATION_UNKNOWN"].includes(x.category)).map((x) => x.code)),
  ];

  let summary: string;
  if (decision === "ALLOW") {
    const auth = license?.reasons.find((r) => r.code === "AUTHORITY_VERIFIED");
    const payerText = f.payer ? (payer.status === "READY" ? "payer participation verified at this site" : "plan needs no enrollment") : "self-pay";
    summary = `Eligible to book — ${auth ? auth.message.replace(/\.$/, "") : `${jurisdiction} authority verified`}; ${payerText}${license?.isDemoRule ? " (DEMO policy — not verified law)" : ""}.`;
  } else {
    const top = blocking.find((x) => x.severity === "BLOCK") ?? blocking[0]!;
    summary = `${decision === "BLOCK" ? "Blocked" : "Needs verification"} — ${top.message}`;
  }

  const evaluatedAt = f.now;
  return {
    decision,
    canConfirm: decision === "ALLOW",
    summary,
    flags,
    jurisdiction,
    patientLocationStatus: locStatus,
    providerLocationState,
    licenseStatus: license?.status ?? "NOT_EVALUATED",
    payerStatus: payer.status,
    ehrMode: mode,
    evidenceIds,
    missingEvidenceCodes,
    policyRuleId: license?.ruleId ?? null,
    policyVersion: license?.ruleLabel ?? null,
    isDemoPolicy: license?.isDemoRule ?? false,
    ruleEffectiveDate: rule?.effectiveFrom ?? null,
    nextRequiredReviewAt: minDate(rule?.nextReviewOn, license?.validThrough),
    validForInstant: f.startAt.toISOString(),
    evaluatedAt: evaluatedAt.toISOString(),
    expiresAt: new Date(evaluatedAt.getTime() + EVALUATION_TTL_MINUTES * 60_000).toISOString(),
  };
}

/* ===================================== DB loading ===================================== */

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export interface EligibilityBase {
  practitioners: Map<string, { profession: Profession; physicalState: string | null; telehealthCapable: boolean }>;
  sites: Map<string, EligibilityFacts["site"]>;
  authorities: Map<string, AuthorityFact[]>;
  rules: RuleFact[];
  plan: (PlanFact & { name: string }) | null;
  enrollments: EnrollmentFact[];
}

/** Batch-load the facts for many practitioner × site combinations (search) or one (booking). */
export async function loadEligibilityBase(
  db: DbOrTx,
  organizationId: string,
  q: { practitionerIds: string[]; siteIds: string[]; payerPlanId?: string | null },
): Promise<EligibilityBase> {
  const [ps, ss, auths, rules, planRows, enr] = await Promise.all([
    q.practitionerIds.length
      ? db
          .select()
          .from(practitioners)
          .where(and(eq(practitioners.organizationId, organizationId), inArray(practitioners.id, q.practitionerIds)))
      : [],
    q.siteIds.length
      ? db
          .select()
          .from(sites)
          .where(and(eq(sites.organizationId, organizationId), inArray(sites.id, q.siteIds)))
      : [],
    q.practitionerIds.length
      ? db
          .select()
          .from(professionalAuthorities)
          .where(and(eq(professionalAuthorities.organizationId, organizationId), inArray(professionalAuthorities.practitionerId, q.practitionerIds)))
      : [],
    db
      .select()
      .from(licensePolicyRules)
      .where(and(eq(licensePolicyRules.organizationId, organizationId), eq(licensePolicyRules.status, "APPROVED"))),
    q.payerPlanId
      ? db
          .select()
          .from(payerPlans)
          .where(and(eq(payerPlans.organizationId, organizationId), eq(payerPlans.id, q.payerPlanId)))
      : [],
    q.payerPlanId && q.practitionerIds.length
      ? db
          .select()
          .from(providerEnrollments)
          .where(
            and(
              eq(providerEnrollments.organizationId, organizationId),
              eq(providerEnrollments.payerPlanId, q.payerPlanId),
              inArray(providerEnrollments.practitionerId, q.practitionerIds),
            ),
          )
      : [],
  ]);
  if (q.payerPlanId && !planRows.length) throw new AppError("VALIDATION_FAILED", "Unknown payer plan.", [{ code: "UNKNOWN_PLAN", field: "payerPlanId" }]);
  const authorities = new Map<string, AuthorityFact[]>();
  for (const a of auths)
    authorities.set(a.practitionerId, [
      ...(authorities.get(a.practitionerId) ?? []),
      {
        id: a.id,
        authorityType: a.authorityType as AuthorityType,
        profession: a.profession as Profession,
        jurisdiction: a.jurisdiction,
        homeState: a.homeState,
        status: a.status,
        effectiveOn: a.effectiveOn,
        expiresOn: a.expiresOn,
        verifiedAt: iso(a.verifiedAt),
      },
    ]);
  return {
    practitioners: new Map(ps.map((p) => [p.id, { profession: p.profession as Profession, physicalState: p.physicalState, telehealthCapable: p.telehealthCapable }])),
    sites: new Map(
      ss.map((s) => [
        s.id,
        { id: s.id, state: s.state, timezone: s.timezone, ehrSyncMode: s.ehrSyncMode as EhrMode, ehrLastSyncedAt: s.ehrLastSyncedAt, ehrFreshnessMinutes: s.ehrFreshnessMinutes },
      ]),
    ),
    authorities,
    rules: rules.map((r) => ({
      id: r.id,
      ruleKey: r.ruleKey,
      ruleVersion: String(r.ruleVersion),
      jurisdiction: r.jurisdiction,
      profession: r.profession as Profession,
      serviceCategory: r.serviceCategory,
      modality: r.modality as Modality,
      authorizationBasis: r.authorizationBasis,
      acceptedHomeStates: r.acceptedHomeStates,
      providerStates: r.providerStates,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      nextReviewOn: r.nextReviewOn,
      status: r.status,
      isDemo: r.isDemo,
    })),
    plan: planRows[0] ? { id: planRows[0].id, requiresEnrollment: planRows[0].requiresEnrollment, name: planRows[0].name } : null,
    enrollments: enr.map((e) => ({
      id: e.id,
      practitionerId: e.practitionerId,
      payerPlanId: e.payerPlanId,
      siteId: e.siteId,
      status: e.status,
      approvedOn: e.approvedOn,
      effectiveOn: e.effectiveOn,
      terminatedOn: e.terminatedOn,
      verifiedAt: iso(e.verifiedAt),
    })),
  };
}

export async function serviceCategoryOf(db: DbOrTx, organizationId: string, appointmentTypeId: string) {
  const [r] = await db
    .select({ category: services.category })
    .from(appointmentTypes)
    .leftJoin(services, eq(services.id, appointmentTypes.serviceId))
    .where(and(eq(appointmentTypes.organizationId, organizationId), eq(appointmentTypes.id, appointmentTypeId)));
  return r?.category ?? null;
}

export interface EvaluateInput {
  practitionerId: string;
  siteId: string;
  appointmentTypeId: string;
  modality: Modality;
  startAt: Date;
  patientLocationState: string | null;
  patientLocationStatus: LocationStatus;
  payerPlanId: string | null;
}

/** Facts from a loaded base for one combination (pure from here on). */
export function factsFor(base: EligibilityBase, input: EvaluateInput, serviceCategory: string | null, capacity: EligibilityFacts["capacity"], now: Date): EligibilityFacts {
  const p = base.practitioners.get(input.practitionerId);
  const s = base.sites.get(input.siteId);
  if (!p || !s) throw new AppError("VALIDATION_FAILED", "Unknown provider or site.", [{ code: "UNKNOWN_TARGET", field: "practitionerId" }]);
  return {
    profession: p.profession,
    practitionerPhysicalState: p.physicalState,
    telehealthCapable: p.telehealthCapable,
    site: s,
    modality: input.modality,
    serviceCategory,
    startAt: input.startAt,
    patientLocationState: input.patientLocationState,
    patientLocationStatus: input.patientLocationStatus,
    rules: base.rules,
    authorities: base.authorities.get(input.practitionerId) ?? [],
    payer: base.plan ? { plan: base.plan, enrollments: base.enrollments, practitionerId: input.practitionerId } : null,
    capacity,
    now,
  };
}

/** Evaluate one candidate (used by booking inside its transaction and by the explain endpoint). */
export async function evaluateEligibility(db: DbOrTx, organizationId: string, input: EvaluateInput, opts: { capacity: EligibilityFacts["capacity"]; now: Date }) {
  const base = await loadEligibilityBase(db, organizationId, { practitionerIds: [input.practitionerId], siteIds: [input.siteId], payerPlanId: input.payerPlanId });
  const cat = await serviceCategoryOf(db, organizationId, input.appointmentTypeId);
  return decideEligibility(factsFor(base, input, cat, opts.capacity, opts.now));
}

/** Persist an immutable evaluation (minimal snapshot: IDs and codes, no patient identity). */
export async function persistEvaluation(
  db: DbOrTx,
  actor: AuthContext | { system: string; organizationId: string },
  input: EvaluateInput,
  r: EligibilityResult,
  link: { trigger: string; appointmentId?: string | null; waitlistOfferId?: string | null },
) {
  const isSystem = "system" in actor;
  const [row] = await db
    .insert(eligibilityEvaluations)
    .values({
      organizationId: actor.organizationId,
      trigger: link.trigger,
      appointmentId: link.appointmentId ?? null,
      waitlistOfferId: link.waitlistOfferId ?? null,
      practitionerId: input.practitionerId,
      siteId: input.siteId,
      appointmentTypeId: input.appointmentTypeId,
      modality: input.modality,
      validForInstant: input.startAt,
      jurisdiction: r.jurisdiction,
      patientLocationState: input.patientLocationState,
      patientLocationStatus: r.patientLocationStatus,
      providerLocationState: r.providerLocationState,
      payerPlanId: input.payerPlanId,
      decision: r.decision,
      canConfirm: r.canConfirm,
      licenseStatus: r.licenseStatus,
      payerStatus: r.payerStatus,
      ehrMode: r.ehrMode,
      flags: r.flags,
      missingEvidenceCodes: r.missingEvidenceCodes,
      evidenceIds: r.evidenceIds,
      policyRuleId: r.policyRuleId,
      policyVersion: r.policyVersion,
      isDemoPolicy: r.isDemoPolicy,
      ruleEffectiveDate: r.ruleEffectiveDate,
      nextRequiredReviewAt: r.nextRequiredReviewAt,
      evaluatedAt: new Date(r.evaluatedAt),
      expiresAt: new Date(r.expiresAt),
      actorUserId: isSystem ? null : actor.userId,
      actorSystem: isSystem ? actor.system : null,
    })
    .returning({ id: eligibilityEvaluations.id });
  return row!.id;
}

/** Appointment eligibility_status column value for a decision (keeps the Phase 2.2 status vocabulary). */
export const statusForDecision = (d: EligibilityDecision) => (d === "ALLOW" ? "VERIFIED_ELIGIBLE" : d === "BLOCK" ? "VERIFIED_INELIGIBLE" : "NEEDS_VERIFICATION");

/** Throw the API error for a non-ALLOW decision (flags are included as details; no PHI). */
export function eligibilityError(r: EligibilityResult, extra = ""): AppError {
  const details = r.flags.filter((x) => x.severity !== "INFO").map((x) => ({ code: x.code, field: x.category, message: x.message }));
  return r.decision === "BLOCK" ? new AppError("ELIGIBILITY_BLOCKED", `${r.summary}${extra}`, details) : new AppError("ELIGIBILITY_REVIEW", `${r.summary}${extra}`, details);
}
