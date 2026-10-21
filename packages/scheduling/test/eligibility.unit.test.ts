import { describe, expect, it } from "vitest";
import type { AuthorityFact, RuleFact } from "@projectos/credentialing/readiness";
import { decideEligibility, type EligibilityFacts } from "../src/eligibility";

/**
 * Exhaustive table fixtures for the EligibilityService core (specs/DEMO_POLICY_FIXTURES.md, TEST_CASES LIC-01…12).
 * DEMO SYNTHETIC POLICY — NOT VERIFIED LAW: every rule below is invented for tests.
 */
const NOW = new Date("2026-10-21T14:00:00Z");
const START = new Date("2026-11-02T15:00:00Z"); // Mon 10:00 EST

let n = 0;
const rule = (jurisdiction: string, profession: string, modality: string, o: Partial<RuleFact> = {}): RuleFact => ({
  id: `rule-${++n}`,
  ruleKey: `${jurisdiction}-${profession}-${modality}`,
  ruleVersion: "1",
  jurisdiction,
  profession: profession as RuleFact["profession"],
  serviceCategory: null,
  modality: modality as RuleFact["modality"],
  authorizationBasis: ["STATE_LICENSE"],
  acceptedHomeStates: [],
  providerStates: [],
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  nextReviewOn: "2027-04-01",
  status: "APPROVED",
  isDemo: true,
  ...o,
});
const RULES: RuleFact[] = [
  rule("VA", "PHYSICIAN", "IN_PERSON"),
  rule("VA", "PHYSICIAN", "VIDEO"),
  rule("MD", "PHYSICIAN", "VIDEO"),
  rule("MD", "RN", "VIDEO", { authorizationBasis: ["STATE_LICENSE", "MULTISTATE_LICENSE"], acceptedHomeStates: ["VA"] }),
  rule("MD", "APRN", "VIDEO"),
  rule("MD", "PSYCHOLOGIST", "VIDEO", { authorizationBasis: ["STATE_LICENSE", "APIT"], acceptedHomeStates: ["VA"] }),
  rule("MD", "LCSW", "VIDEO", { providerStates: ["VA", "MD"] }),
];
const auth = (o: Partial<AuthorityFact>): AuthorityFact => ({
  id: `auth-${++n}`,
  authorityType: "STATE_LICENSE",
  profession: "PHYSICIAN",
  jurisdiction: "VA",
  homeState: null,
  status: "VERIFIED",
  effectiveOn: "2025-01-01",
  expiresOn: "2027-03-31",
  verifiedAt: "2026-01-02T00:00:00Z",
  ...o,
});
const VA_SITE = { id: "site-va", state: "VA", timezone: "America/New_York", ehrSyncMode: "DEMO" as const, ehrLastSyncedAt: null, ehrFreshnessMinutes: 60 };
const facts = (o: Partial<EligibilityFacts> = {}): EligibilityFacts => ({
  profession: "PHYSICIAN",
  practitionerPhysicalState: "VA",
  telehealthCapable: true,
  site: VA_SITE,
  modality: "VIDEO",
  serviceCategory: null,
  startAt: START,
  patientLocationState: "VA",
  patientLocationStatus: "VERIFIED",
  rules: RULES,
  authorities: [auth({})],
  payer: null,
  capacity: { ok: true },
  now: NOW,
  ...o,
});
const codes = (r: ReturnType<typeof decideEligibility>) => r.flags.filter((f) => f.severity !== "INFO").map((f) => f.code);

describe("fixture A — confirmed within designated state", () => {
  it("VA physician, verified VA license, patient verified in VA, video → ALLOW with evidence + DEMO rule", () => {
    const a = auth({});
    const r = decideEligibility(facts({ authorities: [a] }));
    expect(r).toMatchObject({ decision: "ALLOW", canConfirm: true, jurisdiction: "VA", licenseStatus: "VERIFIED_ELIGIBLE", isDemoPolicy: true, evidenceIds: [a.id] });
    expect(r.policyVersion).toBe("VA-PHYSICIAN-VIDEO v1");
    expect(r.summary).toMatch(/^Eligible to book — STATE_LICENSE \(VA\) verified through 2027-03-31; self-pay \(DEMO policy/);
    expect(r.nextRequiredReviewAt).toBe("2027-03-31");
    expect(codes(r)).toEqual([]);
  });
  it("in-person uses the SITE state regardless of the patient's home", () => {
    const r = decideEligibility(facts({ modality: "IN_PERSON", patientLocationState: null, patientLocationStatus: "UNKNOWN" }));
    expect(r.decision).toBe("ALLOW");
    expect(r.jurisdiction).toBe("VA");
  });
});

describe("LIC-01/02 + fixture B/C — patient physically in another state", () => {
  it("VA-home patient physically in MD: decision uses MD; VA-only physician → REVIEW, cannot confirm", () => {
    const r = decideEligibility(facts({ patientLocationState: "MD" }));
    expect(r).toMatchObject({ decision: "REVIEW", canConfirm: false, jurisdiction: "MD" });
    expect(codes(r)).toEqual(["AUTHORITY_MISSING"]);
    expect(r.flags.find((f) => f.code === "AUTHORITY_MISSING")!.category).toBe("LICENSE_REVIEW");
    expect(r.missingEvidenceCodes).toContain("AUTHORITY_MISSING");
  });
  it("LIC-04: an IMLC membership claim is not an MD license", () => {
    const claim = auth({ authorityType: "COMPACT_MEMBERSHIP_CLAIM", jurisdiction: "MD", verifiedAt: null, status: "DRAFT" });
    const r = decideEligibility(facts({ patientLocationState: "MD", authorities: [auth({}), claim] }));
    expect(r.decision).toBe("REVIEW");
    expect(codes(r)).toEqual(["AUTHORITY_MISSING"]);
  });
  it("fixture C: booked MD (ALLOW with MD license) → at check-in patient is in DC with no DC rule → REVIEW", () => {
    const md = auth({ jurisdiction: "MD" });
    expect(decideEligibility(facts({ patientLocationState: "MD", authorities: [md] })).decision).toBe("ALLOW");
    const dc = decideEligibility(facts({ patientLocationState: "DC", authorities: [md] }));
    expect(dc).toMatchObject({ decision: "REVIEW", jurisdiction: "DC", licenseStatus: "POLICY_UNAVAILABLE" });
    expect(codes(dc)).toEqual(["POLICY_UNAVAILABLE"]);
  });
});

describe("LIC-05/06 — RN multistate vs APRN", () => {
  const rnMulti = () => auth({ authorityType: "MULTISTATE_LICENSE", profession: "RN", jurisdiction: "VA", homeState: "VA" });
  it("RN with verified VA multistate license, MD rule explicitly accepts VA home → ALLOW", () => {
    expect(decideEligibility(facts({ profession: "RN", patientLocationState: "MD", authorities: [rnMulti()] })).decision).toBe("ALLOW");
  });
  it("same RN multistate credential does not authorize an APRN", () => {
    const r = decideEligibility(facts({ profession: "APRN", patientLocationState: "MD", authorities: [rnMulti()] }));
    expect(r.decision).toBe("REVIEW");
    expect(codes(r)).toEqual(["AUTHORITY_MISSING"]);
  });
  it("multistate license from a home state the rule does not list → REVIEW (no blanket compact)", () => {
    const r = decideEligibility(
      facts({ profession: "RN", patientLocationState: "MD", authorities: [auth({ authorityType: "MULTISTATE_LICENSE", profession: "RN", jurisdiction: "TX", homeState: "TX" })] }),
    );
    expect(codes(r)).toContain("HOME_STATE_NOT_ACCEPTED");
  });
});

describe("LIC-07 — psychologist and APIT", () => {
  const va = () => auth({ profession: "PSYCHOLOGIST" });
  it("VA license only, patient in MD → REVIEW", () => {
    expect(decideEligibility(facts({ profession: "PSYCHOLOGIST", patientLocationState: "MD", authorities: [va()] })).decision).toBe("REVIEW");
  });
  it("APIT submitted but not verified → REVIEW (AUTHORITY_NOT_VERIFIED)", () => {
    const apit = auth({ authorityType: "APIT", profession: "PSYCHOLOGIST", homeState: "VA", status: "SUBMITTED", verifiedAt: null });
    const r = decideEligibility(facts({ profession: "PSYCHOLOGIST", patientLocationState: "MD", authorities: [va(), apit] }));
    expect(codes(r)).toEqual(["AUTHORITY_NOT_VERIFIED"]);
  });
  it("verified APIT accepted by the MD rule → ALLOW", () => {
    const apit = auth({ authorityType: "APIT", profession: "PSYCHOLOGIST", homeState: "VA" });
    expect(decideEligibility(facts({ profession: "PSYCHOLOGIST", patientLocationState: "MD", authorities: [va(), apit] })).decision).toBe("ALLOW");
  });
});

describe("LIC-08 / fixture G — expired or suspended", () => {
  it("expires Oct 31 → Nov 2 visit BLOCK", () => {
    const r = decideEligibility(facts({ authorities: [auth({ expiresOn: "2026-10-31" })] }));
    expect(r).toMatchObject({ decision: "BLOCK", canConfirm: false });
    expect(codes(r)).toEqual(["AUTHORITY_EXPIRED"]);
    expect(r.flags.find((f) => f.code === "AUTHORITY_EXPIRED")!.category).toBe("LICENSE_BLOCKED");
  });
  it("suspended → BLOCK regardless of expiry date", () => {
    const r = decideEligibility(facts({ authorities: [auth({ status: "SUSPENDED", expiresOn: "2030-01-01" })] }));
    expect(codes(r)).toEqual(["AUTHORITY_SUSPENDED"]);
    expect(r.decision).toBe("BLOCK");
  });
});

describe("LIC-09 / fixture H — no rule, stale rule, unverified evidence", () => {
  it("no approved rule → REVIEW POLICY_UNAVAILABLE", () => {
    expect(codes(decideEligibility(facts({ rules: [] })))).toEqual(["POLICY_UNAVAILABLE"]);
  });
  it("rule review date passed → REVIEW POLICY_REVIEW_EXPIRED", () => {
    const r = decideEligibility(facts({ rules: RULES.map((x) => ({ ...x, nextReviewOn: "2026-10-01" })) }));
    expect(codes(r)).toEqual(["POLICY_REVIEW_EXPIRED"]);
    expect(r.canConfirm).toBe(false);
  });
  it("uploaded but unverified → REVIEW", () => {
    expect(codes(decideEligibility(facts({ authorities: [auth({ status: "SUBMITTED", verifiedAt: null })] })))).toEqual(["AUTHORITY_NOT_VERIFIED"]);
  });
  it("draft or retired rules never count", () => {
    expect(decideEligibility(facts({ rules: RULES.map((x) => ({ ...x, status: "DRAFT" })) })).decision).toBe("REVIEW");
  });
});

describe("LIC-10 / fixture F — payer readiness is separate from license", () => {
  const plan = { id: "plan-y", requiresEnrollment: true };
  const enr = (siteId: string, o = {}) => ({
    id: `enr-${siteId}`,
    practitionerId: "p",
    payerPlanId: "plan-y",
    siteId,
    status: "APPROVED",
    approvedOn: "2026-09-01",
    effectiveOn: "2026-08-01",
    terminatedOn: null,
    verifiedAt: "2026-09-02T00:00:00Z",
    ...o,
  });
  it("approved at site 1 only → visit at site 2 BLOCK PAYER_NOT_ENROLLED while license is eligible", () => {
    const r = decideEligibility(facts({ payer: { plan, enrollments: [enr("other-site")], practitionerId: "p" } }));
    expect(r).toMatchObject({ decision: "BLOCK", licenseStatus: "VERIFIED_ELIGIBLE", payerStatus: "NOT_READY" });
    expect(r.flags.find((f) => f.code === "PAYER_NOT_ENROLLED")!.category).toBe("PAYER_NOT_READY");
  });
  it("pending enrollment at this site → BLOCK; verified approval at this site → ALLOW; unverified → REVIEW", () => {
    expect(decideEligibility(facts({ payer: { plan, enrollments: [enr("site-va", { status: "SUBMITTED" })], practitionerId: "p" } })).decision).toBe("BLOCK");
    expect(decideEligibility(facts({ payer: { plan, enrollments: [enr("site-va")], practitionerId: "p" } })).decision).toBe("ALLOW");
    expect(decideEligibility(facts({ payer: { plan, enrollments: [enr("site-va", { verifiedAt: null })], practitionerId: "p" } })).decision).toBe("REVIEW");
  });
});

describe("LIC-11 — provider physical location", () => {
  it("rule permits providers in VA/MD only; telehealth provider physically in TX → REVIEW", () => {
    const r = decideEligibility(
      facts({ profession: "LCSW", patientLocationState: "MD", practitionerPhysicalState: "TX", authorities: [auth({ profession: "LCSW", jurisdiction: "MD" })] }),
    );
    expect(codes(r)).toEqual(["PROVIDER_LOCATION_UNAPPROVED"]);
    expect(r.providerLocationState).toBe("TX");
  });
});

describe("LIC-12 / fixture K — patient location unknown", () => {
  it("video visit with no location → REVIEW LOCATION_UNKNOWN; license not evaluated", () => {
    const r = decideEligibility(facts({ patientLocationState: null, patientLocationStatus: "UNKNOWN" }));
    expect(r).toMatchObject({ decision: "REVIEW", jurisdiction: null, licenseStatus: "NOT_EVALUATED", patientLocationStatus: "UNKNOWN" });
    expect(codes(r)).toEqual(["LOCATION_UNKNOWN"]);
  });
  it("in-person with a different recorded state → REVIEW LOCATION_MISMATCH", () => {
    expect(codes(decideEligibility(facts({ modality: "IN_PERSON", patientLocationState: "MD" })))).toEqual(["LOCATION_MISMATCH"]);
  });
});

describe("fixture J — EHR source of truth", () => {
  it("EHR master with stale sync → REVIEW EHR_STALE; fresh but no write adapter → REVIEW; read-only → BLOCK", () => {
    const stale = decideEligibility(facts({ site: { ...VA_SITE, ehrSyncMode: "EHR_MASTER", ehrLastSyncedAt: new Date(NOW.getTime() - 3 * 3600_000) } }));
    expect(stale.decision).toBe("REVIEW");
    expect(codes(stale)).toEqual(["EHR_STALE"]);
    const fresh = decideEligibility(facts({ site: { ...VA_SITE, ehrSyncMode: "EHR_MASTER", ehrLastSyncedAt: new Date(NOW.getTime() - 5 * 60_000) } }));
    expect(codes(fresh)).toEqual(["EHR_WRITE_NOT_CONNECTED"]);
    expect(decideEligibility(facts({ site: { ...VA_SITE, ehrSyncMode: "READ_ONLY" } })).decision).toBe("BLOCK");
    expect(decideEligibility(facts({ site: { ...VA_SITE, ehrSyncMode: "STANDALONE_APPROVED" } })).decision).toBe("ALLOW");
  });
});

describe("capacity and combination", () => {
  it("occupied time → BLOCK CAPACITY_CONFLICT even when everything else is fine", () => {
    const r = decideEligibility(facts({ capacity: { ok: false, reason: "PROVIDER_BUSY" } }));
    expect(r.decision).toBe("BLOCK");
    expect(r.flags.find((f) => f.code === "PROVIDER_BUSY")!.category).toBe("CAPACITY_CONFLICT");
    expect(r.summary).toMatch(/^Blocked — Another appointment/);
  });
  it("BLOCK wins over REVIEW; all non-info flags are reported", () => {
    const r = decideEligibility(facts({ patientLocationState: "MD", capacity: { ok: false, reason: "OUTSIDE_WORKING_HOURS" } }));
    expect(r.decision).toBe("BLOCK");
    expect(codes(r).sort()).toEqual(["AUTHORITY_MISSING", "OUTSIDE_WORKING_HOURS"]);
  });
  it("not telehealth-capable → BLOCK for video", () => {
    expect(codes(decideEligibility(facts({ telehealthCapable: false })))).toEqual(["PROVIDER_NOT_TELEHEALTH"]);
  });
  it("the evaluation carries an expiry so UI and API treat old results as stale", () => {
    const r = decideEligibility(facts());
    expect(new Date(r.expiresAt).getTime() - new Date(r.evaluatedAt).getTime()).toBe(15 * 60_000);
  });
});
