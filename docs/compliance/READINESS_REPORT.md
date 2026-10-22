# PHI Readiness Report — **NOT APPROVED FOR REAL PHI**

_Date: 2026-10-22 · Build: Phase 8 (v0.3.0-rc.1) · Mode: DEVELOPMENT / DEMO_SYNTHETIC only_

ProjectOS Health is **not approved for real patient information** and must not be described as "HIPAA compliant".
This report summarizes what the software now does to support a future approval, and lists everything that can only be
satisfied outside the software. The live version of this report is **Administration → PHI Readiness** (`/admin/compliance`),
which computes the verdict from the evidence checklist and automated technical checks.

## Verdict rule (implemented in `packages/compliance`)
`NOT APPROVED FOR REAL PHI` unless **all** of the following hold — and even then the app only says
"Eligible for sponsor go-live decision"; the decision itself is a signed document outside the software:
1. Every critical checklist item is `APPROVED` — evidence submitted by one person, approved by a **different** person
   (enforced by the application and by a database CHECK constraint).
2. Every automated technical check passes: approved APP_MODE, MFA on every privileged account, HTTPS, non-default
   secret, restore drill passed in the last 7 days, clinic-day rehearsal in the last 30 days, load test / clean-deployment
   restore / migration-rollback drills passed in the last 30 days (Phase 8), no DEMO licensure rules,
   every site has a real source-of-truth decision (a synthetic simulator never counts), no dead-lettered work, audit log
   append-only.

Current state (demo database after the Phase 8 drills): 0/19 items approved, 6 of 13 technical checks failing — **NOT APPROVED**.
Phase 8 release evidence (PASS/BLOCKED per item): docs/release/RC_CHECKLIST.md.

## What Phase 7 implemented and verified (synthetic only)
| Area | Status | Evidence |
|---|---|---|
| EHR adapter contract with per-capability verification (FHIR R4 subset) | Built; only a **synthetic simulator** exists | `packages/integrations/src/adapter.ts`, ADR-0012 |
| EHR_MASTER fail-closed booking (stale/unreachable → drafts only, 503 on confirm) | Built, tested (EHR-01) | `ehr.int.test.ts`, `e2e/phase7.spec.ts`, rehearsal |
| Exactly-once external create on retry (idempotency key + unique mapping) | Built, tested (EHR-02) | `ehr.int.test.ts`, rehearsal |
| Reconciliation, change feed, conflict queue, replay | Built, tested | Integration Health `/admin/integrations` |
| Patient identifier mapping (exact match only; none/ambiguous → conflict) | Built, tested | `ehr.int.test.ts` |
| MFA (TOTP + backup codes) with enforcement for privileged roles outside synthetic modes | Built, tested | `e2e/phase7.spec.ts`, `/account/security` |
| Audit of patient record reads (patient detail/search, appointment detail with identity) and MFA events | Built | `packages/scheduling/src/patients.ts`, `packages/auth/src/server.ts` |
| Paper downtime schedule (audited export) | Built | `/scheduling/downtime`, DOWNTIME_PLAN.md |
| Encrypted backup + restore drill with row-count verification | Built, run: PASS | BACKUP_RESTORE_RUNBOOK.md |
| Synthetic clinic-day rehearsal (9 safety assertions) | Built, run: PASS | CLINIC_DAY_REHEARSAL.md |
| Secret scan + dependency audit in CI | Built | `scripts/security/scan-secrets.mjs`, `.github/workflows/ci.yml` |

## Manual / external tasks (cannot be done in software — owners from the checklist)
1. Name privacy and security officers (Executive sponsor).
2. Review and complete the data-flow inventory (`DATA_FLOW.md`) for the real deployment (Privacy officer).
3. Formal HIPAA security risk analysis + accepted remediation plan (`SECURITY_RISK_REGISTER.md` is a starting point only).
4. Execute BAAs with the provider organization and every PHI-handling subcontractor (hosting, backups, email/SMS, monitoring, support).
5. Choose eligible hosting and configure encryption, network isolation, access control, backups and logging; get it reviewed.
6. EHR: identify the vendor, sign the API agreement, obtain sandbox access, verify each adapter capability against vendor
   documentation, implement the vendor adapter, and sign the per-site source-of-truth decision.
7. Licensure rules: replace all DEMO rules with counsel-reviewed rules (two-person approval already enforced).
8. Payer participation data verified by contracting/credentialing.
9. Independent penetration test; triage SAST/dependency findings (see register: dev-tooling advisories).
10. Approve RPO/RTO; store encrypted backups off-host; schedule weekly restore drills.
11. Incident response + breach notification tabletop (`INCIDENT_RESPONSE.md`).
12. Staff training on workflow, patient-location protocol, downtime plan; then the sponsor's signed risk acceptance and
    a limited, reversible pilot plan.

Until every item is complete: **keep APP_MODE=DEVELOPMENT or DEMO_SYNTHETIC and use synthetic data only.**
