/**
 * Deterministic, side-effect-free readiness evaluation (no DB, no clock, no AI).
 *
 * LICENSE readiness answers: "does verified, unexpired evidence satisfy a compliance-APPROVED,
 * in-effect policy rule for this profession + jurisdiction + modality on this date?"
 * PAYER readiness answers a different question and is computed independently.
 *
 * Fail-closed: anything unknown, unverified, stale or ambiguous is REVIEW (never ALLOW).
 * Compact membership is never inferred: multistate/APIT evidence only counts when an approved
 * rule for the destination jurisdiction explicitly accepts that basis AND the authority's home state.
 */
import type { AuthorityType, Modality, Profession } from "@projectos/shared";

export type Decision = "ALLOW" | "REVIEW" | "BLOCK";
export type LicenseStatus = "VERIFIED_ELIGIBLE" | "NEEDS_VERIFICATION" | "EXPIRED" | "VERIFIED_INELIGIBLE" | "POLICY_UNAVAILABLE";
export type PayerStatus = "READY" | "NOT_READY" | "UNKNOWN" | "NOT_REQUIRED";

export interface Reason {
  code: string;
  message: string;
  severity: "BLOCK" | "REVIEW" | "INFO";
  evidenceId?: string;
}

export interface AuthorityFact {
  id: string;
  authorityType: AuthorityType;
  profession: Profession;
  jurisdiction: string;
  homeState: string | null;
  status: string; // DRAFT | SUBMITTED | VERIFIED | REJECTED | SUSPENDED | REVOKED | EXPIRED
  effectiveOn: string;
  expiresOn: string | null;
  verifiedAt: string | null;
}

export interface RuleFact {
  id: string;
  ruleKey: string;
  ruleVersion: string;
  jurisdiction: string;
  profession: Profession;
  serviceCategory: string | null;
  modality: Modality;
  authorizationBasis: string[];
  acceptedHomeStates: string[];
  providerStates: string[];
  effectiveFrom: string;
  effectiveTo: string | null;
  nextReviewOn: string;
  status: string; // only APPROVED rules are considered
  isDemo: boolean;
}

export interface LicenseContext {
  profession: Profession;
  jurisdiction: string; // patient's location at visit time (later phases) / column being evaluated (Phase 3)
  modality: Modality;
  date: string; // YYYY-MM-DD the service would happen
  serviceCategory?: string | null;
  providerPhysicalState?: string | null;
  /** "Today" for staleness checks of rule reviews (injected — never read from the clock here). */
  asOf: string;
}

export interface LicenseResult {
  status: LicenseStatus;
  decision: Decision;
  canConfirm: boolean;
  reasons: Reason[];
  evidenceIds: string[];
  ruleId: string | null;
  ruleLabel: string | null;
  isDemoRule: boolean;
  validThrough: string | null;
}

const inEffect = (from: string, to: string | null, d: string) => from <= d && (to === null || d < to);
const valid = (a: AuthorityFact, d: string) => a.effectiveOn <= d && (a.expiresOn === null || d <= a.expiresOn);

/** Does this authority (of the right profession) apply to the destination under this rule? */
function appliesUnder(a: AuthorityFact, rule: RuleFact): boolean {
  if (!rule.authorizationBasis.includes(a.authorityType)) return false;
  if (a.authorityType === "MULTISTATE_LICENSE" || a.authorityType === "APIT") {
    // Never inferred from a compact map: the rule must list the authority's home state explicitly.
    return !!a.homeState && rule.acceptedHomeStates.includes(a.homeState);
  }
  return a.jurisdiction === rule.jurisdiction;
}

function result(partial: Omit<LicenseResult, "canConfirm" | "decision"> & { decision?: Decision }): LicenseResult {
  const decision =
    partial.decision ?? (partial.status === "VERIFIED_ELIGIBLE" ? "ALLOW" : partial.status === "EXPIRED" || partial.status === "VERIFIED_INELIGIBLE" ? "BLOCK" : "REVIEW");
  return { ...partial, decision, canConfirm: decision === "ALLOW" };
}

export function evaluateLicenseReadiness(ctx: LicenseContext, rules: RuleFact[], authorities: AuthorityFact[]): LicenseResult {
  const reasons: Reason[] = [];
  const base = { evidenceIds: [] as string[], ruleId: null, ruleLabel: null, isDemoRule: false, validThrough: null };

  // Hard blocks first: a suspended/revoked authority for this profession + jurisdiction blocks regardless of anything else.
  const hardStops = authorities.filter((a) => a.profession === ctx.profession && a.jurisdiction === ctx.jurisdiction && (a.status === "SUSPENDED" || a.status === "REVOKED"));
  if (hardStops.length) {
    return result({
      ...base,
      status: "VERIFIED_INELIGIBLE",
      evidenceIds: hardStops.map((a) => a.id),
      reasons: hardStops.map((a) => ({
        code: `AUTHORITY_${a.status}`,
        message: `Provider's ${ctx.jurisdiction} authority is ${a.status.toLowerCase()}.`,
        severity: "BLOCK",
        evidenceId: a.id,
      })),
    });
  }

  const candidates = rules.filter(
    (r) =>
      r.status === "APPROVED" &&
      r.jurisdiction === ctx.jurisdiction &&
      r.profession === ctx.profession &&
      r.modality === ctx.modality &&
      inEffect(r.effectiveFrom, r.effectiveTo, ctx.date) &&
      (r.serviceCategory === null || !ctx.serviceCategory || r.serviceCategory === ctx.serviceCategory),
  );
  if (!candidates.length) {
    const claim = authorities.find((a) => a.profession === ctx.profession && a.authorityType === "COMPACT_MEMBERSHIP_CLAIM");
    return result({
      ...base,
      status: "POLICY_UNAVAILABLE",
      reasons: [
        { code: "POLICY_UNAVAILABLE", message: `No compliance-approved rule covers ${ctx.profession} · ${ctx.jurisdiction} · ${ctx.modality} on ${ctx.date}.`, severity: "REVIEW" },
        ...(claim
          ? [
              {
                code: "COMPACT_CLAIM_NOT_AUTHORITY",
                message: "A compact membership claim is recorded but is not an issued authority.",
                severity: "INFO" as const,
                evidenceId: claim.id,
              },
            ]
          : []),
      ],
    });
  }
  // Prefer the most specific (service-scoped) rule, then the newest effective version.
  const rule = [...candidates].sort((a, b) => Number(!!b.serviceCategory) - Number(!!a.serviceCategory) || b.effectiveFrom.localeCompare(a.effectiveFrom))[0]!;
  const ruleInfo = { ruleId: rule.id, ruleLabel: `${rule.ruleKey} v${rule.ruleVersion}`, isDemoRule: rule.isDemo };
  if (rule.isDemo) reasons.push({ code: "DEMO_RULE", message: "DEMO SYNTHETIC POLICY — NOT VERIFIED LAW.", severity: "INFO" });
  if (rule.nextReviewOn < ctx.asOf) {
    return result({
      ...base,
      ...ruleInfo,
      status: "POLICY_UNAVAILABLE",
      reasons: [...reasons, { code: "POLICY_REVIEW_EXPIRED", message: `Rule review was due ${rule.nextReviewOn}; booking on hold until re-reviewed.`, severity: "REVIEW" }],
    });
  }

  if (rule.providerStates.length) {
    if (!ctx.providerPhysicalState) {
      reasons.push({ code: "PROVIDER_LOCATION_UNKNOWN", message: "Provider's physical location is required by this rule but not recorded.", severity: "REVIEW" });
    } else if (!rule.providerStates.includes(ctx.providerPhysicalState)) {
      reasons.push({
        code: "PROVIDER_LOCATION_UNAPPROVED",
        message: `Provider physically in ${ctx.providerPhysicalState}; rule permits ${rule.providerStates.join(", ")}.`,
        severity: "REVIEW",
      });
    }
  }

  const sameProfession = authorities.filter((a) => a.profession === ctx.profession && a.authorityType !== "COMPACT_MEMBERSHIP_CLAIM");
  const applicable = sameProfession.filter((a) => appliesUnder(a, rule));
  const good = applicable.filter((a) => a.status === "VERIFIED" && a.verifiedAt !== null && valid(a, ctx.date));

  if (good.length) {
    const reviewReasons = reasons.filter((r) => r.severity === "REVIEW");
    const through = good.map((a) => a.expiresOn).reduce<string | null>((m, e) => (e === null ? m : m === null || e > m ? e : m), null);
    return result({
      ...base,
      ...ruleInfo,
      status: reviewReasons.length ? "NEEDS_VERIFICATION" : "VERIFIED_ELIGIBLE",
      evidenceIds: good.map((a) => a.id),
      validThrough: good.some((a) => a.expiresOn === null) ? null : through,
      reasons: [
        ...reasons,
        ...good.map((a) => ({
          code: "AUTHORITY_VERIFIED",
          message: `${a.authorityType} (${a.jurisdiction}) verified${a.expiresOn ? ` through ${a.expiresOn}` : ""}.`,
          severity: "INFO" as const,
          evidenceId: a.id,
        })),
      ],
    });
  }

  const expired = applicable.filter((a) => (a.status === "VERIFIED" || a.status === "EXPIRED") && a.expiresOn !== null && a.expiresOn < ctx.date);
  if (expired.length) {
    return result({
      ...base,
      ...ruleInfo,
      status: "EXPIRED",
      evidenceIds: expired.map((a) => a.id),
      reasons: [
        ...reasons,
        ...expired.map((a) => ({
          code: "AUTHORITY_EXPIRED",
          message: `${a.authorityType} (${a.jurisdiction}) expired ${a.expiresOn}.`,
          severity: "BLOCK" as const,
          evidenceId: a.id,
        })),
      ],
    });
  }
  const notYet = applicable.filter((a) => a.status === "VERIFIED" && a.effectiveOn > ctx.date);
  const pending = applicable.filter((a) => a.status === "DRAFT" || a.status === "SUBMITTED");
  const wrongHome = sameProfession.filter(
    (a) => (a.authorityType === "MULTISTATE_LICENSE" || a.authorityType === "APIT") && rule.authorizationBasis.includes(a.authorityType) && !appliesUnder(a, rule),
  );
  const otherProfession = authorities.filter((a) => a.profession !== ctx.profession && a.jurisdiction === ctx.jurisdiction && a.status === "VERIFIED");
  return result({
    ...base,
    ...ruleInfo,
    status: "NEEDS_VERIFICATION",
    evidenceIds: [...pending, ...notYet].map((a) => a.id),
    reasons: [
      ...reasons,
      ...pending.map((a) => ({
        code: "AUTHORITY_NOT_VERIFIED",
        message: `${a.authorityType} (${a.jurisdiction}) is ${a.status.toLowerCase()} — not yet verified.`,
        severity: "REVIEW" as const,
        evidenceId: a.id,
      })),
      ...notYet.map((a) => ({
        code: "AUTHORITY_NOT_YET_EFFECTIVE",
        message: `${a.authorityType} (${a.jurisdiction}) effective ${a.effectiveOn}.`,
        severity: "REVIEW" as const,
        evidenceId: a.id,
      })),
      ...wrongHome.map((a) => ({
        code: "HOME_STATE_NOT_ACCEPTED",
        message: `${a.authorityType} home state ${a.homeState} is not accepted by this rule.`,
        severity: "REVIEW" as const,
        evidenceId: a.id,
      })),
      ...otherProfession.map((a) => ({
        code: "DIFFERENT_PROFESSION_AUTHORITY",
        message: `A verified ${a.profession} authority exists but does not apply to ${ctx.profession}.`,
        severity: "INFO" as const,
        evidenceId: a.id,
      })),
      ...(pending.length || notYet.length
        ? []
        : [{ code: "AUTHORITY_MISSING", message: `No ${ctx.profession} authority accepted for ${ctx.jurisdiction} by this rule is on file.`, severity: "REVIEW" as const }]),
    ],
  });
}

// ---------------- Payer readiness (independent of licensure) ----------------

export interface PlanFact {
  id: string;
  requiresEnrollment: boolean;
}
export interface EnrollmentFact {
  id: string;
  practitionerId: string;
  payerPlanId: string;
  siteId: string;
  status: string;
  approvedOn: string | null;
  effectiveOn: string | null;
  terminatedOn: string | null;
  verifiedAt: string | null;
}
export interface PayerResult {
  status: PayerStatus;
  reasons: Reason[];
  evidenceIds: string[];
}

export function evaluatePayerReadiness(ctx: { practitionerId: string; siteId: string; date: string }, plan: PlanFact, enrollments: EnrollmentFact[]): PayerResult {
  if (!plan.requiresEnrollment)
    return {
      status: "NOT_REQUIRED",
      reasons: [{ code: "PAYER_ENROLLMENT_NOT_REQUIRED", message: "Plan does not require provider enrollment.", severity: "INFO" }],
      evidenceIds: [],
    };
  // Site-specific: an approval at another site never counts here.
  const e = enrollments.find((x) => x.practitionerId === ctx.practitionerId && x.payerPlanId === plan.id && x.siteId === ctx.siteId);
  if (!e) {
    const elsewhere = enrollments.some((x) => x.practitionerId === ctx.practitionerId && x.payerPlanId === plan.id && x.status === "APPROVED");
    return {
      status: "NOT_READY",
      evidenceIds: [],
      reasons: [
        {
          code: "PAYER_NOT_ENROLLED",
          message: elsewhere ? "Approved at a different site only — not at this site." : "No enrollment on file for this plan at this site.",
          severity: "BLOCK",
        },
      ],
    };
  }
  if (e.status === "APPROVED") {
    if (!e.verifiedAt)
      return {
        status: "UNKNOWN",
        evidenceIds: [e.id],
        reasons: [{ code: "PAYER_APPROVAL_UNVERIFIED", message: "Approval recorded but not verified by an approver.", severity: "REVIEW", evidenceId: e.id }],
      };
    if (e.effectiveOn && e.effectiveOn > ctx.date)
      return {
        status: "NOT_READY",
        evidenceIds: [e.id],
        reasons: [{ code: "PAYER_NOT_YET_EFFECTIVE", message: `Participation effective ${e.effectiveOn}.`, severity: "BLOCK", evidenceId: e.id }],
      };
    if (e.terminatedOn && e.terminatedOn <= ctx.date)
      return {
        status: "NOT_READY",
        evidenceIds: [e.id],
        reasons: [{ code: "PAYER_TERMINATED", message: `Participation ended ${e.terminatedOn}.`, severity: "BLOCK", evidenceId: e.id }],
      };
    return {
      status: "READY",
      evidenceIds: [e.id],
      reasons: [{ code: "PAYER_READY", message: `Participating since ${e.effectiveOn} (approval confirmed ${e.approvedOn}).`, severity: "INFO", evidenceId: e.id }],
    };
  }
  const code = e.status === "TERMINATED" ? "PAYER_TERMINATED" : e.status === "DENIED" ? "PAYER_DENIED" : "PAYER_PENDING";
  return {
    status: "NOT_READY",
    evidenceIds: [e.id],
    reasons: [{ code, message: `Enrollment status: ${e.status.replace("_", " ").toLowerCase()}.`, severity: "BLOCK", evidenceId: e.id }],
  };
}
