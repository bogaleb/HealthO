# ADR-0003 — Authoritative appointment source

**Status:** Accepted for the synthetic build (Phase 7); the per-site decision for real patients is still OPEN and must be signed by scheduling operations.

Each site runs in one mode (blueprint §4.5): `DEMO`, `READ_ONLY`, `EHR_MASTER`, `STANDALONE_APPROVED`. The mode is stored on the site,
changed only by `integrations.manage` (audited), and `STANDALONE_APPROVED` is refused outside an approved APP_MODE.
`EHR_MASTER` is implemented end to end against a **synthetic EHR simulator** (ADR-0012): bookings are written through the adapter and
confirmed only after the EHR accepts them; stale or unreachable EHR → drafts only. No real EHR is connected; a real vendor needs a
verified adapter and capability sign-off first. The demo NEDC site runs `EHR_MASTER` on the simulator; ALX and SSP are `DEMO`.
