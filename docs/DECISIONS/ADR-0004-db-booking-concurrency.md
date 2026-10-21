# ADR-0004 — Database-enforced booking concurrency

**Status:** Accepted in principle — implementation in Phase 4

Double-booking prevention will use `btree_gist` + an exclusion constraint on `resource_reservations` (`WHERE state = 'ACTIVE'`, no `now()` in the predicate), with eligibility re-evaluated inside the booking transaction and constraint violations mapped to `409 SLOT_CONFLICT`.

The same discipline is already used in Phases 1–2: optimistic `version` columns on every editable record (409 `VERSION_CONFLICT`), an idempotency-key table for retried creates, a per-organization advisory lock for dependency-graph edits, and `FOR UPDATE SKIP LOCKED` job claiming.
