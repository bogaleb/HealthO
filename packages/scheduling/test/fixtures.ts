import type { Db } from "@projectos/db";
import { approveRule, createAuthority, createRuleDraft, submitAuthority, verifyAuthority } from "@projectos/credentialing";
import type { Fixture } from "../../core/test/helpers";

/**
 * DEMO SYNTHETIC POLICY — NOT VERIFIED LAW. Test-only rules and verified evidence so scheduling tests can
 * reach ALLOW through the real credentialing workflow (draft → approve by a different person; submit → verify).
 */
export async function eligibilityFixture(db: Db, org: Fixture) {
  const spec = await org.user("credspec", [{ roleId: org.roleIds.credentialing_specialist! }]);
  const approver = await org.user("credappr", [{ roleId: org.roleIds.credentialing_approver! }]);
  const compliance = await org.user("compliance", [{ roleId: org.roleIds.compliance_officer! }]);
  const rule = async (jurisdiction: string, modality: string, profession = "PHYSICIAN") => {
    const d = await createRuleDraft(db, await spec.ctx(), {
      jurisdiction,
      profession,
      modality,
      authorizationBasis: ["STATE_LICENSE"],
      effectiveFrom: "2026-01-01",
      nextReviewOn: "2028-01-01",
      sourceSummary: "DEMO SYNTHETIC POLICY — NOT VERIFIED LAW (test fixture)",
      isDemo: true,
    });
    return approveRule(db, await compliance.ctx(), d.id, { reason: "Test fixture only" });
  };
  const license = async (practitionerId: string, jurisdiction: string, o: Record<string, unknown> = {}) => {
    const a = await createAuthority(db, await spec.ctx(), practitionerId, {
      authorityType: "STATE_LICENSE",
      profession: "PHYSICIAN",
      jurisdiction,
      licenseNumberLast4: "9999",
      effectiveOn: "2025-01-01",
      expiresOn: "2028-12-31",
      ...o,
    });
    const s = await submitAuthority(db, await spec.ctx(), a.id, { version: a.version });
    return verifyAuthority(db, await approver.ctx(), a.id, { version: s.version, sourceName: "Synthetic check (test)", verifiedOn: "2026-10-01" });
  };
  return { spec, approver, compliance, rule, license };
}
