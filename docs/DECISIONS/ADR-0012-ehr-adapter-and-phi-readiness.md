# ADR-0012 — EHR scheduling adapter, synthetic simulator, fail-closed write-through and PHI-readiness tooling

Status: Accepted (Phase 7) · Date: 2026-10-22

## Context
Prompt 07: build the integration design and PHI readiness without connecting real patient data; start with a synthetic EHR
simulator; never pretend a vendor supports an API without verified documentation and access; fail closed when an authoritative EHR
is unreachable or stale; produce a readiness report marked NOT APPROVED FOR REAL PHI.

## Decisions
1. **Adapter contract** (`packages/integrations/src/adapter.ts`): `health, getProviders, getLocations, getAvailability, searchPatients,
   createAppointment, updateAppointment, cancelAppointment, getAppointmentByExternalId, pullChanges` over a FHIR R4 subset
   (Appointment with Patient/Practitioner/Location participants, busy blocks ≈ Slot). Each capability carries `supported` (adapter
   implements it) and `verified` + `verifiedBy` (a person confirmed it for this connection). Only supported ∧ verified capabilities are
   used; anything else throws `CapabilityNotVerifiedError`. `UnverifiedVendorAdapter` supports nothing and its health is always
   "not connected", so the UI cannot show an unverified vendor as connected.
2. **Synthetic simulator in Postgres** (`ehr_sim_*` tables) so web and worker share remote state. It honours idempotency keys, ETags
   (`W/"n"`), a change sequence, refuses double booking of a practitioner, and has failure modes for drills: `UNREACHABLE`,
   `FAIL_WRITES`, `TIMEOUT_AFTER_WRITE`.
3. **Write-through via the transactional outbox.** At an `EHR_MASTER` site a booking/reschedule/cancel writes an `ehr.write` outbox row in
   the same transaction. The appointment stays `PENDING` (`ehr_state = PENDING_CREATE/UPDATE`) until the worker's delivery succeeds; a DB
   CHECK forbids `CONFIRMED`/`CHECKED_IN`/`COMPLETED` while `ehr_state` is `DRAFT`, `PENDING_CREATE` or `FAILED`.
   Create uses the stable key `projectos:appointment:<id>:create`, so a retry after a timeout returns the original external appointment
   (EHR-02: exactly one external appointment, one mapping — unique on appointment and on external id).
4. **Fail closed.** Eligibility gets an `ehrWrite` fact: `VERIFIED` (write capabilities verified, last health OK) → INFO
   `EHR_WRITE_THROUGH` (ALLOW); `UNAVAILABLE` → REVIEW `EHR_UNAVAILABLE`; no verified write path → REVIEW `EHR_WRITE_NOT_CONNECTED`;
   availability older than the site's freshness limit → REVIEW `EHR_STALE`. REVIEW can only be saved as a **draft**; confirming a draft
   while the EHR is unavailable/stale returns **503** `EHR_UNAVAILABLE` (EHR-01).
5. **Permanent vs retryable failures.** Unreachable/timeout → backoff retries; rejected/unmapped/ambiguous patient/ETag conflict →
   `PermanentDeliveryError` → DEAD at once with an `onDead` hook that marks the booking `FAILED` and opens a conflict. Nothing is dropped
   silently; Integration Health offers Retry (re-queues with the same EHR idempotency key) and the outbox Replay.
6. **Patient identifier mapping**: exact match on the identifier (synthetic MRN) only; zero or several matches → `PATIENT_NOT_FOUND` /
   `PATIENT_AMBIGUOUS` conflict, never a fuzzy guess. Practitioners/locations are mapped at connection setup.
7. **Availability sync** imports EHR-only busy times as BLOCK exceptions (`external_ref`), so they are never offered; success refreshes the
   site's freshness timestamp. **Change feed** and **reconciliation** detect EHR-side cancellations/moves/deletions → the local booking goes
   to `NEEDS_RESCHEDULE` + conflict; "Accept EHR" cancels locally without sending a second cancel. Worker: sync every 5 min, reconcile hourly.
8. **PHI readiness** (`packages/compliance`): 19-item evidence checklist (blueprint §9.2 + GO_LIVE_CHECKLIST) with dual control in app and DB,
   10 automated technical checks (13 since Phase 8 — ADR-0013), append-only `ops_drills`, verdict `NOT APPROVED FOR REAL PHI` by default and in every synthetic mode.
9. **Security remediations by risk:** TOTP MFA (Better Auth two-factor plugin; secrets encrypted with the auth secret; backup codes), mandatory
   for privileged roles outside synthetic modes (page redirect + API 403 `MFA_REQUIRED`); patient-read and MFA audit events; secret scan
   and dependency audit in CI; encrypted backup + verified restore drill; paper downtime schedule; clinic-day rehearsal.

## Consequences
- Adding a real vendor = implement its adapter, verify capabilities with vendor docs + sandbox, flip `verified` per capability, and sign the
  site's source-of-truth decision. No code path treats the simulator as a real EHR (readiness check fails while it is used).
- EHR_MASTER bookings are visibly "awaiting EHR confirmation" until the worker runs; the worker is now required for EHR sites.
- Synthetic rehearsal orgs created by `pnpm ops:rehearsal` remain in the database as evidence (their site/connection are deactivated).
