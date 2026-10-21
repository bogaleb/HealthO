# Prompt 03 — Provider records, credentialing, payer readiness

Implement Phase 3 in current repo. Read licensing guidance sections of `MASTER_BLUEPRINT.md` carefully; NEVER synthesize real legal authorization from a state/compact map. No PHI.

Data: practitioners, professions, specialties, practitioner-site association, services, professional_authorities, authority_verifications, approved license_policy_rules, payer/plans, provider_enrollments, credentialing_cases, linked project tasks and audit. Seed synthetic providers representing medical, RN, psychology, licensed therapist, with demo statuses clearly labeled and never used as current-law statements. Support draft → review → verified/rejected and expiration; only credentialing approver can approve verified evidence or publish rules. If dual-control configured, actor cannot approve own submission. No inferred blanket IMLC, NLC, PSYPACT permissions.

UI `/providers`, `/providers/[id]`, `/credentialing/cases`, `/credentialing/readiness`, `/admin/rules`. Include state/profession filters, evidence detail and expiration badges. Implement action deadlines 90/60/30 days and idempotent tasks. Payer-site-plan readiness must be independently determined from legal authority. Provide deterministic isolated tests and full API validation/auth/audit. Run tests, record pass/fail and update progress.
