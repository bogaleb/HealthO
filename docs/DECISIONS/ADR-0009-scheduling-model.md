# ADR-0009 — Scheduling, holds and database-enforced no-double-booking

**Status:** Accepted (Phase 4, 2026-10-21)

## Decisions
1. **One reservation table for every competing claim.** Provider and room time for appointments and temporary holds is a row in
   `resource_reservations`. A `btree_gist` exclusion constraint (`resource_reservations_no_overlap`) forbids two `ACTIVE` rows for the
   same `(organization, resource type, resource id)` with overlapping `[start, end)` ranges. Back-to-back is allowed.
2. **No `now()` in the constraint.** The partial predicate is `state = 'ACTIVE'` only. An expired hold keeps blocking until it is
   *explicitly* released — by the worker (`releaseExpiredHolds`, `FOR UPDATE SKIP LOCKED`, one SYSTEM audit event per hold) or by a booking
   that hits a conflict, which runs the same audited release once and retries. An unexpired hold always wins.
3. **Reservations are immutable and never deleted** (DB trigger): release flips `ACTIVE → RELEASED` once; a move releases and inserts.
4. **Buffers reserve capacity.** The reserved range is the visit widened by the type's before/after buffers. Visits must fit inside a
   working block; buffers may extend into a break.
5. **Booking, reschedule and cancel are single transactions**: re-validate type/modality, provider affiliation + service + telehealth
   capability, working hours, notice/horizon, time off, closures and current reservations; then write appointment, reservations,
   `appointment_events` (append-only) and `audit_events`. A 23P01 exclusion violation becomes `409 SLOT_CONFLICT` with up to five alternative
   times and never another patient's data. A failed reschedule rolls back completely: the original keeps its time, version and reservations.
6. **Idempotent create** via `Idempotency-Key` (same `idempotency_keys` table as tasks); cancel retries are no-ops; every other change is
   version-checked.
7. **Time zones.** Instants are `timestamptz`; templates hold wall-clock times in the **site's** IANA zone. `resolveLocal` reports DST gaps
   (nonexistent) and overlaps (ambiguous, both instants with explicit offsets) and never guesses; template boundaries in a gap move to the
   first existing instant, and on fall-back a block spans the repeated hour. APIs accept instants only with an explicit offset.
8. **Synthetic demo gate.** Holds, bookings and reschedules require a synthetic `APP_MODE` **and** `SCHEDULING_MODE=DEMO_ONLY`. Eligibility
   is stored and shown as `POLICY_PENDING` — never "eligible" — until the Phase 5 EligibilityService exists. Patients can only be created as
   synthetic records (`DEMO-0001…`).
9. **Patient location is per appointment** (`patient_location_state` + `PROPOSED/VERIFIED`), independent of home state.
10. **Permissions.** `scheduling.read` (site-scoped) to view; `scheduling.manage` at the site to hold/book/change; new
    `scheduling.configure` for templates/rooms/time off (site-scoped) and appointment types (org-wide); `patients.read` to see patient names
    (otherwise "Patient (restricted)").

## Not supported (documented, not hidden)
Capacity > 1 (group visits, shared rooms), equipment reservations (type exists, no UI), waitlist, outbound notifications, EHR sync,
automatic rescheduling after time off (impacted appointments are flagged for manual review only).
