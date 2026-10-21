import { describe, expect, it } from "vitest";
import { evaluateLicenseReadiness, evaluatePayerReadiness, type AuthorityFact, type EnrollmentFact, type RuleFact } from "../src/readiness";

// DEMO SYNTHETIC POLICY — NOT VERIFIED LAW. Fixtures mirror specs/DEMO_POLICY_FIXTURES.md.
const rule = (o: Partial<RuleFact>): RuleFact => ({
  id: `rule-${o.jurisdiction}-${o.profession}-${o.modality}`,
  ruleKey: "demo",
  ruleVersion: "1",
  jurisdiction: "VA",
  profession: "PHYSICIAN",
  serviceCategory: null,
  modality: "VIDEO",
  authorizationBasis: ["STATE_LICENSE"],
  acceptedHomeStates: [],
  providerStates: [],
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  nextReviewOn: "2027-06-30",
  status: "APPROVED",
  isDemo: true,
  ...o,
});
const auth = (o: Partial<AuthorityFact>): AuthorityFact => ({
  id: `auth-${o.authorityType ?? "STATE_LICENSE"}-${o.jurisdiction ?? "VA"}-${o.status ?? "VERIFIED"}`,
  authorityType: "STATE_LICENSE",
  profession: "PHYSICIAN",
  jurisdiction: "VA",
  homeState: null,
  status: "VERIFIED",
  effectiveOn: "2025-01-01",
  expiresOn: "2027-03-31",
  verifiedAt: "2026-09-01T00:00:00Z",
  ...o,
});
const ctx = (o: Partial<Parameters<typeof evaluateLicenseReadiness>[0]>) => ({
  profession: "PHYSICIAN" as const,
  jurisdiction: "VA",
  modality: "VIDEO" as const,
  date: "2026-11-03",
  providerPhysicalState: "VA",
  asOf: "2026-10-20",
  ...o,
});
const RULES = [
  rule({ jurisdiction: "VA", profession: "PHYSICIAN", modality: "VIDEO" }),
  rule({ jurisdiction: "VA", profession: "PHYSICIAN", modality: "IN_PERSON" }),
  rule({ jurisdiction: "MD", profession: "PHYSICIAN", modality: "VIDEO" }),
  rule({ jurisdiction: "MD", profession: "RN", modality: "VIDEO", authorizationBasis: ["STATE_LICENSE", "MULTISTATE_LICENSE"], acceptedHomeStates: ["VA"] }),
  rule({ jurisdiction: "MD", profession: "APRN", modality: "VIDEO", authorizationBasis: ["STATE_LICENSE"] }),
  rule({ jurisdiction: "MD", profession: "PSYCHOLOGIST", modality: "VIDEO", authorizationBasis: ["STATE_LICENSE", "APIT"], acceptedHomeStates: ["VA"] }),
];

describe("license readiness — fixture table (DEMO policy)", () => {
  const cases: [string, ReturnType<typeof ctx>, AuthorityFact[], string, string, string?][] = [
    ["A: verified VA license, VA video", ctx({}), [auth({})], "VERIFIED_ELIGIBLE", "ALLOW"],
    ["A: verified VA license, VA in person", ctx({ modality: "IN_PERSON" }), [auth({})], "VERIFIED_ELIGIBLE", "ALLOW"],
    ["B/LIC-01/LIC-02: VA-only physician, patient in MD", ctx({ jurisdiction: "MD" }), [auth({})], "NEEDS_VERIFICATION", "REVIEW", "AUTHORITY_MISSING"],
    [
      "B/LIC-04: IMLC membership claim does not authorize MD",
      ctx({ jurisdiction: "MD" }),
      [auth({}), auth({ authorityType: "COMPACT_MEMBERSHIP_CLAIM", jurisdiction: "MD", status: "VERIFIED" })],
      "NEEDS_VERIFICATION",
      "REVIEW",
      "AUTHORITY_MISSING",
    ],
    ["C/LIC-03: DC has no approved rule", ctx({ jurisdiction: "DC" }), [auth({})], "POLICY_UNAVAILABLE", "REVIEW", "POLICY_UNAVAILABLE"],
    ["D/LIC-05: RN multistate, home VA accepted for MD", ctx({ profession: "RN", jurisdiction: "MD" }), [auth({ profession: "RN", authorityType: "MULTISTATE_LICENSE", homeState: "VA" })], "VERIFIED_ELIGIBLE", "ALLOW"],
    [
      "D: RN multistate with home state not accepted",
      ctx({ profession: "RN", jurisdiction: "MD" }),
      [auth({ profession: "RN", authorityType: "MULTISTATE_LICENSE", jurisdiction: "PA", homeState: "PA" })],
      "NEEDS_VERIFICATION",
      "REVIEW",
      "HOME_STATE_NOT_ACCEPTED",
    ],
    [
      "D/LIC-06: RN multistate never authorizes an APRN visit",
      ctx({ profession: "APRN", jurisdiction: "MD" }),
      [auth({ profession: "RN", authorityType: "MULTISTATE_LICENSE", homeState: "VA" })],
      "NEEDS_VERIFICATION",
      "REVIEW",
      "AUTHORITY_MISSING",
    ],
    [
      "E/LIC-07: psychologist licensed in VA, no APIT → MD video needs review",
      ctx({ profession: "PSYCHOLOGIST", jurisdiction: "MD" }),
      [auth({ profession: "PSYCHOLOGIST" })],
      "NEEDS_VERIFICATION",
      "REVIEW",
      "AUTHORITY_MISSING",
    ],
    [
      "E: unverified APIT does not authorize",
      ctx({ profession: "PSYCHOLOGIST", jurisdiction: "MD" }),
      [auth({ profession: "PSYCHOLOGIST" }), auth({ profession: "PSYCHOLOGIST", authorityType: "APIT", homeState: "VA", status: "SUBMITTED", verifiedAt: null })],
      "NEEDS_VERIFICATION",
      "REVIEW",
      "AUTHORITY_NOT_VERIFIED",
    ],
    [
      "E: verified APIT + approved rule → allow",
      ctx({ profession: "PSYCHOLOGIST", jurisdiction: "MD" }),
      [auth({ profession: "PSYCHOLOGIST", authorityType: "APIT", homeState: "VA" })],
      "VERIFIED_ELIGIBLE",
      "ALLOW",
    ],
    ["G/LIC-08: expires Oct 31, visit Nov 1", ctx({ date: "2026-11-01" }), [auth({ expiresOn: "2026-10-31" })], "EXPIRED", "BLOCK", "AUTHORITY_EXPIRED"],
    ["G: same license, visit on expiry day is still valid", ctx({ date: "2026-10-31" }), [auth({ expiresOn: "2026-10-31" })], "VERIFIED_ELIGIBLE", "ALLOW"],
    ["G/LIC-09: suspended blocks regardless of dates", ctx({}), [auth({ status: "SUSPENDED", expiresOn: "2030-01-01" })], "VERIFIED_INELIGIBLE", "BLOCK", "AUTHORITY_SUSPENDED"],
    ["G: suspended blocks even with another valid authority", ctx({}), [auth({}), auth({ id: "x", status: "REVOKED" })], "VERIFIED_INELIGIBLE", "BLOCK", "AUTHORITY_REVOKED"],
    ["H: uploaded but unverified", ctx({}), [auth({ status: "SUBMITTED", verifiedAt: null })], "NEEDS_VERIFICATION", "REVIEW", "AUTHORITY_NOT_VERIFIED"],
    ["H: draft evidence", ctx({}), [auth({ status: "DRAFT", verifiedAt: null })], "NEEDS_VERIFICATION", "REVIEW", "AUTHORITY_NOT_VERIFIED"],
    ["rejected evidence counts as missing", ctx({}), [auth({ status: "REJECTED", verifiedAt: null })], "NEEDS_VERIFICATION", "REVIEW", "AUTHORITY_MISSING"],
    ["not yet effective", ctx({}), [auth({ effectiveOn: "2026-12-01" })], "NEEDS_VERIFICATION", "REVIEW", "AUTHORITY_NOT_YET_EFFECTIVE"],
    ["LIC-11: provider physically outside permitted origination state", ctx({ providerPhysicalState: "FL" }), [auth({})], "VERIFIED_ELIGIBLE", "ALLOW"],
  ];
  it.each(cases)("%s", (_name, c, authorities, status, decision, code) => {
    const r = evaluateLicenseReadiness(c, RULES, authorities);
    expect(r.status).toBe(status);
    expect(r.decision).toBe(decision);
    expect(r.canConfirm).toBe(decision === "ALLOW");
    if (code) expect(r.reasons.map((x) => x.code)).toContain(code);
    if (decision === "ALLOW") expect(r.evidenceIds.length).toBeGreaterThan(0);
  });

  it("LIC-11: provider location condition on the rule → review", () => {
    const rules = [rule({ providerStates: ["VA", "MD", "DC"] })];
    const r = evaluateLicenseReadiness(ctx({ providerPhysicalState: "FL" }), rules, [auth({})]);
    expect(r.decision).toBe("REVIEW");
    expect(r.reasons.map((x) => x.code)).toContain("PROVIDER_LOCATION_UNAPPROVED");
    expect(evaluateLicenseReadiness(ctx({ providerPhysicalState: null }), rules, [auth({})]).reasons.map((x) => x.code)).toContain("PROVIDER_LOCATION_UNKNOWN");
  });

  it("H/LIC-10: stale rule review → review, canConfirm false", () => {
    const r = evaluateLicenseReadiness(ctx({ asOf: "2027-07-01", date: "2027-01-02" }), RULES, [auth({ expiresOn: null })]);
    expect(r.status).toBe("POLICY_UNAVAILABLE");
    expect(r.reasons.map((x) => x.code)).toContain("POLICY_REVIEW_EXPIRED");
    expect(r.canConfirm).toBe(false);
  });

  it("LIC-09 variant: only APPROVED, in-effect rules count", () => {
    const draftOnly = [rule({ status: "DRAFT" }), rule({ id: "r", status: "RETIRED" })];
    expect(evaluateLicenseReadiness(ctx({}), draftOnly, [auth({})]).status).toBe("POLICY_UNAVAILABLE");
    const future = [rule({ effectiveFrom: "2027-01-01" })];
    expect(evaluateLicenseReadiness(ctx({}), future, [auth({})]).status).toBe("POLICY_UNAVAILABLE");
    const ended = [rule({ effectiveTo: "2026-11-01" })];
    expect(evaluateLicenseReadiness(ctx({}), ended, [auth({})]).status).toBe("POLICY_UNAVAILABLE");
  });

  it("is deterministic and marks demo rules", () => {
    const a = evaluateLicenseReadiness(ctx({}), RULES, [auth({})]);
    const b = evaluateLicenseReadiness(ctx({}), RULES, [auth({})]);
    expect(a).toEqual(b);
    expect(a.isDemoRule).toBe(true);
    expect(a.reasons.map((r) => r.code)).toContain("DEMO_RULE");
    expect(a.validThrough).toBe("2027-03-31");
  });
});

describe("payer readiness — independent of licensure (F / LIC-10 / CRED-02)", () => {
  const plan = { id: "plan-y", requiresEnrollment: true };
  const approvedSite1: EnrollmentFact = { id: "e1", practitionerId: "p", payerPlanId: "plan-y", siteId: "site-1", status: "APPROVED", approvedOn: "2026-09-15", effectiveOn: "2026-09-01", terminatedOn: null, verifiedAt: "2026-09-16T00:00:00Z" };
  it("approved at Site 1 only → ready at Site 1, not ready at Site 2", () => {
    expect(evaluatePayerReadiness({ practitionerId: "p", siteId: "site-1", date: "2026-11-03" }, plan, [approvedSite1]).status).toBe("READY");
    const s2 = evaluatePayerReadiness({ practitionerId: "p", siteId: "site-2", date: "2026-11-03" }, plan, [approvedSite1]);
    expect(s2.status).toBe("NOT_READY");
    expect(s2.reasons[0]!.message).toMatch(/different site/);
  });
  it("pending, unverified, not-yet-effective, terminated, not required", () => {
    const at = (e: Partial<typeof approvedSite1>) => evaluatePayerReadiness({ practitionerId: "p", siteId: "site-1", date: "2026-11-03" }, plan, [{ ...approvedSite1, ...e }]);
    expect(at({ status: "SUBMITTED" }).reasons[0]!.code).toBe("PAYER_PENDING");
    expect(at({ verifiedAt: null }).status).toBe("UNKNOWN");
    expect(at({ effectiveOn: "2026-12-01" }).reasons[0]!.code).toBe("PAYER_NOT_YET_EFFECTIVE");
    expect(at({ terminatedOn: "2026-11-01" }).reasons[0]!.code).toBe("PAYER_TERMINATED");
    expect(evaluatePayerReadiness({ practitionerId: "p", siteId: "site-1", date: "2026-11-03" }, { id: "x", requiresEnrollment: false }, []).status).toBe("NOT_REQUIRED");
  });
});
