# ADR-0010 — Deterministic EligibilityService for license-aware scheduling

**Status:** Accepted (Phase 5, 2026-10-21)

## Decision
One pure function, `decideEligibility(facts)` (`packages/scheduling/src/eligibility.ts`), decides every scheduling eligibility
question. No database, no clock, no AI. Search, the explain endpoint, holds, booking, reschedule, check-in, location change,
re-check, the rescreen job and waitlist offers all load facts and call it — so UI and API always derive the same result.

### Inputs
Profession; provider physical state (telehealth) or site state (in person); telehealth capability; site (state, IANA zone,
EHR source-of-truth mode and last sync); modality; service category; visit instant; **patient location at visit time** and
whether it is proposed / verified / unknown; verified professional authorities; compliance-APPROVED, effective-dated rules;
optional payer plan + site-specific enrollments; capacity (when part of the question).

### Output
`decision` ALLOW / REVIEW / BLOCK, `canConfirm` (true only for ALLOW), a one-line `summary`, and `flags` — each with a code,
a category (below), severity, message and remediation — plus jurisdiction, license status, payer status, EHR mode,
evidence IDs, missing-evidence codes, rule ID + version, demo flag, rule effective date, next required review date,
`evaluatedAt` and `expiresAt` (15-minute TTL).

### Categories (separate metadata in `CATEGORY_META`)
`LICENSE_REVIEW`, `LICENSE_BLOCKED`, `PAYER_NOT_READY`, `LOCATION_UNKNOWN`, `EHR_STALE`, `CAPACITY_CONFLICT`, `SCHEDULE_UNAVAILABLE`
— each with owner, remediation text and whether it creates a follow-up task.

### Rules (fail closed)
1. Jurisdiction = where the patient physically is at visit time; for in-person visits the site's state. Home state never counts.
2. Video/audio with unknown location → REVIEW `LOCATION_UNKNOWN`; license is not evaluated.
3. License reuses the Phase 3 `evaluateLicenseReadiness` (same answer as the readiness matrix): no approved/in-effect rule or an
   overdue rule review → REVIEW; unverified evidence → REVIEW; expired/suspended/revoked → BLOCK. Compact membership claims never
   authorize; multistate/APIT evidence counts only when the destination rule lists the authority's home state.
4. Payer is independent: enrollment is per provider × plan × **site**; not enrolled/pending/denied → BLOCK, approval unverified → REVIEW.
5. EHR: `EHR_MASTER` sites → REVIEW (`EHR_STALE` past freshness, otherwise `EHR_WRITE_NOT_CONNECTED` because the adapter is a stub);
   `READ_ONLY` → BLOCK; `DEMO` / `STANDALONE_APPROVED` → no flag.
6. Any BLOCK flag → BLOCK; else any REVIEW → REVIEW; else ALLOW.

### Commit points and persistence
Every commit point writes an immutable `eligibility_evaluations` row (DB trigger) — including refused attempts (`BOOK_ATTEMPT`,
`RESCHEDULE_ATTEMPT`), which are also audited as `DENY` with reason codes. Snapshots hold IDs and codes only (no patient identity).
- Book: ALLOW → CONFIRMED; REVIEW → 409 unless staff explicitly `acceptPendingReview` → PENDING (holds the time, not confirmed);
  BLOCK → 422. Eligible alternatives (any eligible provider at the site) are returned with refusals.
- Reschedule: re-evaluated in the same transaction; refusal leaves the original untouched.
- Check-in: re-evaluated with the location confirmed now; non-ALLOW stops the visit (status PENDING/NEEDS_RESCHEDULE, committed),
  creates a follow-up task and returns 409/422.
- Location change / manual re-check / rescreen job: status mapping ALLOW keeps status (a PENDING booking is never auto-confirmed),
  REVIEW → PENDING, BLOCK → NEEDS_RESCHEDULE. Nothing is cancelled or re-booked automatically.
- Credentialing changes (verify, suspend/revoke, rule approve/retire, enrollment update/verify) enqueue a `scheduling.rescreen` job;
  the worker also rescreens hourly. Only changed decisions are written (idempotent).
- Follow-up tasks: one per provider × context × reason code × month in the auto-created `ELIG` project, no patient data.
- Waitlist offers are created only for ALLOW results, hold the time until expiry and are re-evaluated on acceptance
  (INVALIDATED if no longer eligible).

## Consequences / gaps
- All policy content is DEMO SYNTHETIC POLICY — NOT VERIFIED LAW. A real deployment needs counsel-reviewed rules.
- Not yet modeled: documented temporary-practice exceptions with expiry, supervision/age/service restrictions, provider location
  confirmation at visit time, patient age rules, insurance-type rules beyond enrollment, EHR adapter writes.
