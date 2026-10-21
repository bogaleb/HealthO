# Prompt 04 — Real persisted synthetic patient/provider scheduling

Implement Phase 4. Use only fake patients. Protect patient data and use server authorization. Existing database and licenses from earlier phases remain.

Build appointment types (duration, buffer, modality/service), site/provider working templates with IANA timezone, breaks, PTO/closure exceptions, rooms/resources, minimal patients (external-id-ready), appointments with auditable state transitions, appointment holds with explicit expiry worker and resource reservations. Add PostgreSQL `btree_gist` exclusion constraint so provider and room/resource cannot be actively reserved twice for overlapping ranges. `now()` must NOT appear in the active-partial-index condition. Booking, cancellation, and rescheduling are transactional, idempotent and optimistic concurrency-aware. If reschedule fails, original remains.

UI `/scheduling/calendar`, `/scheduling/find`, `/scheduling/appointments/new`, patient selector; day/week by provider/site, state/timezone clearly displayed; appointment drawer and reasoned conflicts. Implement server-side slot search. **Before the policy engine phase is implemented**, keep booking behind an explicit synthetic DEMO_ONLY flag and show eligibility as 'policy pending'; do not claim it supports real license rules. Avoid client-only booking authority.

Tests: two concurrent bookings same provider => exactly one success; room conflict; buffer overlaps; cancellation release; stale hold worker; DST gaps/overlaps; reschedule atomicity; unauthorized booking. Update docs and prove pages run in real browser.
