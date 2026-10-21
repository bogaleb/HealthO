# Prompt 05 — License-aware scheduling & provider matching (most critical)

Implement Phase 5. Read MASTER_BLUEPRINT sections 2.3, 5.5, 8 and TEST_CASES.csv. No real patient data, no legal inference by AI, and **no blanket compact allow-lists**.

Create the deterministic EligibilityService and its fully typed API with documented decisions `ALLOW`,`BLOCK`,`REVIEW` and reason codes. Persist immutable eligibility evaluations referencing verified evidence and approved effective-dated policy versions. Inputs include actual/proposed patient state **at visit time**, provider physical state where applicable, provider profession/service/modality, site, appointment time, professional authorities, compact authorizations only with individual evidence, patient location verification, payer-plan/site readiness, real calendar capacity, current authoritative EHR sync mode. Fail closed on unknown/stale/unverified evidence.

Build readable blocked-slot explanations, Find Appointment filters and eligible alternatives, license/payer readiness matrix, policy/evidence tasks, and rescreen on booking commit, reschedule, check-in and state change. Implement waitlist offers with expiry and re-evaluation. Create separate metadata for `PAYER_NOT_READY`, `LICENSE_REVIEW`, `EHR_STALE`, `LOCATION_UNKNOWN`, `CAPACITY_CONFLICT`.

Mandatory scenarios: a VA-home patient physically in MD; VA-only provider doesn't automatically qualify; a patient changes MD→DC at check-in; physician merely claims IMLC membership but MD license missing; RN NLC conditions vs APRN exclusion; psychologist in PSYPACT jurisdiction without verified APIT; expired/suspended authority; valid license but payer plan/site enrollment pending; provider physically in unapproved state; policy review expired; two schedulers race same slot. Do not hardcode current laws; fixture policy sets must carry DEMO warning.

Tests: pure function exhaustive table fixtures; integration book/reschedule/check-in using live DB; E2E eligible and blocked flows; permission/audit on policy publication. UI and API must derive same result, including when a prior result expires. Fix failing tests. Describe current gaps clearly.
