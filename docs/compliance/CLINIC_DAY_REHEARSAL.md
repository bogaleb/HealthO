# Clinic-day rehearsal (SYNTHETIC) — last run

Run with `pnpm ops:rehearsal` (also executed by the integration test suite). It builds an isolated synthetic organization, runs one scripted day at an EHR-master site against the synthetic EHR simulator, asserts the safety properties at each step, and records the result in `ops_drills`.

Rehearsal day 2026-10-26, isolated synthetic organization 21b6ad6f-6afb-4ec3-9924-e32090dee930, EHR-master site on the synthetic EHR simulator.

| Time | Step | Result | Detail |
|---|---|---|---|
| 07:00 | Morning health check + availability sync | ✅ PASS | health true; EHR-only busy blocks imported: 1 |
| 07:05 | Time booked directly in the EHR is not offered | ✅ PASS | 12:00–13:00 hidden (busy in EHR) |
| 07:35 | Bookings wait for the EHR, then confirm | ✅ PASS | 6/6 confirmed after EHR acceptance; none confirmed before |
| 10:05 | EHR outage: fail closed, drafts only, paper list printed | ✅ PASS | direct booking refused (1); confirm → 503 (true); 2 drafts; downtime list rows: 8 |
| 11:05 | Recovery: drafts sent and confirmed by the EHR | ✅ PASS | 2/2 confirmed |
| 11:35 | EHR-side cancellation detected and accepted | ✅ PASS | local status after change feed: NEEDS_RESCHEDULE; after Accept EHR: CANCELLED |
| 12:00 | Timeout after EHR write: retry creates no duplicate | ✅ PASS | EHR appointments for the booking: 1; status CONFIRMED |
| 13:30 | Check-ins re-evaluate eligibility; visits completed; no-show recorded | ✅ PASS | 4/4 checked in; 3 completed; 1 no-show |
| 17:30 | End-of-day reconciliation clean; no dead letters | ✅ PASS | checked 9 mappings, missing 0, open conflicts 0, dead letters 0 |

9/9 steps passed. NOT APPROVED FOR REAL PHI — this exercises software behavior with synthetic data only.
