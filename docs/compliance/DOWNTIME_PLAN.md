# Manual downtime plan (synthetic rehearsal version)

**When:** ProjectOS is unavailable, or the EHR (master schedule) is unreachable/stale at an EHR_MASTER site.

## Before downtime (every morning, and when the Integration Health page shows a site as STALE)
1. Front-desk lead prints **Scheduling → Downtime Schedule** (`/scheduling/downtime`) for today (and tomorrow if late in the day).
   The print is audited. It shows time, provider, patient name + MRN, visit type and status (minimum necessary).
2. Keep the printout in the locked front-desk folder; shred at end of day.

## During downtime
- **EHR down, ProjectOS up (EHR_MASTER site):** ProjectOS refuses to confirm (fail closed). Save new requests as
  **drafts** ("Save as pending") and tell the patient the time is *requested*, not confirmed. Do not book the same
  time in a second system.
- **ProjectOS down:** if the EHR is the master, book in the EHR directly; the next ProjectOS sync imports those times
  as busy. Otherwise write requests on the paper sheet (name, MRN, requested time, provider, patient's location for
  telehealth).
- Check-in on paper: tick "Arrived" and note the patient's **current state** for video/audio visits.

## Recovery
1. Integration Health → **Sync now**, then **Reconcile now**; confirm the site shows "current".
2. Open drafts (status Pending, "EHR draft") and **Confirm** each — it is sent to the EHR and becomes Confirmed only
   when the EHR accepts it.
3. Enter paper bookings (EHR first if it is the master). Resolve any conflicts on the Integration Health page.
4. Record the downtime (start/end, impact) in the incident log.

## Clinic-site outage (internet or power down at one clinic; the system itself is up) — Phase 8
1. The clinic lead calls the on-call line and switches the site to the **printed downtime schedule** (printed every
   morning — see above). Another site or the central scheduler (who can still reach ProjectOS) books for the affected clinic
   by phone; times booked centrally are visible to the clinic on its next print or when the connection returns.
2. Telehealth providers at the affected site move to a backup connection (mobile hotspot on an approved device) or the
   central scheduler reschedules with the patient; nothing is marked "seen" until it is recorded.
3. Paper check-ins (arrival time, patient's **current state** for video/audio visits) are entered within 24 h of recovery
   by the clinic lead; eligibility is re-evaluated automatically on entry.
4. If the outage lasts longer than half a clinic day, the operations lead decides on closing the site in the system
   (Scheduling › Setup › closure) so no new bookings land there; impacted bookings are flagged, never auto-cancelled.

## Whole-system outage (ProjectOS unavailable for everyone)
- ALB/web failure: ECS replaces failed tasks; a bad release is rolled back (docs/ops/RELEASE_RUNBOOK.md §4).
- Database failure: Multi-AZ fails over automatically (1–2 min); a corrupted database is restored from PITR (RTO target
  ≤ 4 h, RPO ≤ 5 min — proposed, to be approved). During the outage all sites use the morning print + paper bookings
  (above), and the EHR remains the record at EHR_MASTER sites.

Rehearsed in the synthetic clinic-day drill (10:00–11:05 steps) — see CLINIC_DAY_REHEARSAL.md.
