# Prompt 07 — EHR integration design and PHI readiness (NO automatic go-live)

Read `MASTER_BLUEPRINT.md` sections 4.5 and 9 and `specs/GO_LIVE_CHECKLIST.md`. Do not connect to real patient data without explicit organizational/compliance/vendor approvals and valid agreements. This phase starts with synthetic EHR simulator.

1. Build `EhrSchedulingAdapter` interface with capability flags and demo adapter; choose appropriate FHIR R4 mapping where vendor allows. Support availability sync, patient identifier mapping, appointment create/reschedule/cancel/get, idempotency and reconciliation. Model modes `DEMO`, `READ_ONLY`, `EHR_MASTER`, `STANDALONE_APPROVED` per site. If EHR master unreachable/stale => do not silently confirm; queue draft and show error.
2. Build Integration Health UI (last success, data freshness, mapping conflicts, outbox, retry/dead letters), include reconciliation and replay tests. Do not pretend existing EHR supports API functions without verified vendor docs/access.
3. Create compliance evidence checklist: data flows, BAAs, security risk assessment, HIPAA eligible services, audit/backup restore, MFA, incident response, license policy approval, clinical ops source of truth, vendor agreements, messaging decisions and go-live signoffs. Implement security remediations prioritized by actual risk and clearly list manual/external tasks.
4. Create synthetic rehearsal of scheduled clinic day, manual downtime plan, and rollback/backup restore drill. Run tests.

**Deliverable:** working simulation and a readiness report marked `NOT APPROVED FOR REAL PHI` until all independent criteria are satisfied. Do not call the app HIPAA compliant.
