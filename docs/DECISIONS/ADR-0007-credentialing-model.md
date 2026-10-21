# ADR-0007 — Credentialing, evidence and readiness model

**Status:** Accepted (Phase 3, 2026-10-21)

## Decisions
1. **Professions are fixed codes** (`PHYSICIAN, APRN, RN, LPN, PSYCHOLOGIST, LCSW, LPC, PA`), not a free-form table. Policy rules match on them exactly, so an RN authority can never satisfy an APRN rule and a psychologist's authority never satisfies an LCSW's. Specialties and services *are* org-scoped tables.
2. **Evidence lifecycle:** `DRAFT → SUBMITTED → VERIFIED | REJECTED`, plus `SUSPENDED / REVOKED / EXPIRED`. Every transition writes an **append-only** `authority_verifications` row (DB trigger) and an audit event. Only the last 4 characters of a license number are stored.
3. **Dual control is ON by default** (`organizations.settings_json.dualControl !== false`):
   - the person who entered or submitted evidence cannot verify it;
   - the author of a policy rule cannot approve it;
   - the person who recorded a payer approval cannot verify it.
4. **Policy rules** are effective-dated and versioned per `rule_key` (`JURISDICTION-PROFESSION-MODALITY[-SERVICE]`). Approving v(n+1) retires v(n). Approved rules are immutable in the database (trigger); only retirement is allowed. `COMPACT_MEMBERSHIP_CLAIM` can never be a basis (CHECK constraint).
5. **No inferred compacts.** Multistate (NLC-style) and APIT evidence only count when an approved rule for the *destination* jurisdiction lists that basis **and** explicitly lists the authority's home state. A rule with those bases cannot be saved without accepted home states.
6. **Readiness is computed, not stored**, by the pure function `evaluateLicenseReadiness` (no DB, no clock — `asOf` injected), so UI, API and later the Phase-5 EligibilityService share one implementation. Precedence: suspended/revoked → BLOCK; no in-effect approved rule or overdue rule review → REVIEW; verified + in-date evidence → ALLOW; expired → BLOCK; otherwise REVIEW. Only ALLOW has `canConfirm = true`.
7. **Payer readiness is a separate function** and is **site-specific**: an approval at Site A never counts at Site B. Approval requires both a confirmation date and a (possibly retro) effective date, and must be verified by a second person.
8. **Credentialing visibility**: org-wide grants see all practitioners; site-scoped grants see practitioners affiliated with that site. Department-scoped credentialing grants do not apply (practitioners are not owned by a department).
9. **Deadlines**: a daily idempotent job expires past-due verified evidence and creates **one** renewal task for the tightest 90/60/30-day threshold reached, in an auto-created `RENEW` project. A unique key per (authority, threshold, expiry date) prevents duplicates across reruns and concurrent workers.

## Consequences
- Readiness changes immediately when evidence, rules or enrollments change (no cache to invalidate).
- Phase 5 will persist immutable `eligibility_evaluations` snapshots at booking time, reusing this evaluator.
