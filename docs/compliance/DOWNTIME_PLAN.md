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

Rehearsed in the synthetic clinic-day drill (10:00–11:05 steps) — see CLINIC_DAY_REHEARSAL.md.
