# PROGRESS — ProjectOS Health

_Last updated: 2026-10-22 · Current phase: **Phase 7 complete (synthetic) → next is Phase 8 (Prompt 08_PRODUCTION_HARDENING)** · Readiness verdict: **NOT APPROVED FOR REAL PHI**_

Mode: `DEVELOPMENT`, **synthetic data only**. External EHR: **not connected** — only a synthetic EHR simulator exists (ADR-0012). **NOT APPROVED FOR REAL PHI** (docs/compliance/READINESS_REPORT.md).

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Monorepo, Postgres, migrations, seed, auth, health checks, logging, CI, docs | ✅ Done, verified |
| 1 | Org-scoped memberships, sites/departments/teams, roles & scoped grants, invites, staff/roles/sites/audit UI, server-side permission gates, negative tests | ✅ Done, verified |
| 2 | Projects, milestones, tasks (2-level), checklist, comments, dependencies, activity, board/list/calendar/My Work, templates, recurring tasks (idempotent), job worker | ✅ Done, verified |
| 3 | Practitioners, professional authorities + verification, license policy rules (dual control), payers/plans/enrollments, credentialing cases, readiness matrix, deadline job | ✅ Done, verified |
| 4 | Scheduling (synthetic demo): appointment types, rooms, working hours, time off/closures, synthetic patients, slot search, holds + expiry worker, booking/reschedule/cancel/status with DB exclusion constraint, calendar/find/new/setup UI | ✅ Done, verified |
| 5 | Deterministic EligibilityService (license + payer + location + EHR + capacity), immutable evaluations, rescreen on book/reschedule/check-in/location/evidence change, follow-up tasks, waitlist offers | ✅ Done, verified |
| 6 | RCM work queues/cases (synthetic claim refs), bulk assign + undo, escalation, project/credentialing links, operations dashboard + reports that reconcile, outbox-backed in-app reminders, worker health/replay, keyboard a11y tests | ✅ Done, verified |
| 7 | EHR adapter contract + synthetic simulator, EHR_MASTER fail-closed write-through, availability/change sync, reconciliation, Integration Health, PHI-readiness checklist + checks, MFA, patient-read audit, downtime print, restore drill, clinic-day rehearsal | ✅ Done (synthetic), verified |
| 8 | Production hardening | ⏳ Next |
| 9 | Commercial expansion | Not started |

## What works (verified in a real browser against PostgreSQL 16)
- Sign in / out (Better Auth, DB sessions, httpOnly cookies), generic error on bad credentials, sign-in rate limiting, redirect when signed out.
- Synthetic banner on every page; `/api/v1/health/live` and `/ready`.
- **Home**: SQL-derived counts with definitions + computed-at timestamp; each tile drills down to `/tasks` with the identical filter.
- **Staff & Permissions**: list/filter by department & status, invite (one-time code) → `/invite` acceptance, edit role grants with org/site/department scope, suspend/reactivate. Anti-escalation enforced server-side.
- **Roles**: built-in catalog + custom roles (org admins), permission checkboxes limited to what you hold.
- **Sites & Departments**: CRUD with IANA time zone + jurisdiction validation, activate/deactivate, departments & teams.
- **Audit log**: ALLOW/DENY/ERROR events with actor, request id, redacted metadata; DB trigger makes it append-only.
- **Projects**: portfolio with live open/overdue/done counts, create from template, scoped by department/site.
- **Board**: drag-and-drop + keyboard-accessible "move to" select and up/down buttons, optimistic update with rollback, blocked badges, filters; persists across reload.
- **List**: server-side filters (in the URL) + pagination. **Calendar**: month grid by due date. **My Work**: overdue/today/upcoming/no-date.
- **Task drawer** (URL `?task=`): edit fields with version check (409 → reload prompt), status, owner, collaborators, labels, due date, checklist, subtasks (max depth 2), dependencies with cycle guard, comments, activity feed, delete with confirmation.
- **Providers** (`/providers`, `/providers/:id`): directory with filters and evidence counts; profile with sites/specialties/services, professional authorities (DRAFT → SUBMITTED → VERIFIED/REJECTED, SUSPENDED/REVOKED/EXPIRED; last-4 only), append-only verification history, per-jurisdiction readiness (in-person + video) and payer readiness.
- **Dual control** (default on): the submitter cannot verify evidence, a rule author cannot approve the rule, the person recording a payer approval cannot verify it — enforced server-side (HTTP 403) and in the UI.
- **License Policy Rules** (`/admin/rules`): effective-dated, versioned rules labelled *DEMO — not verified law*; approving v(n+1) retires v(n); approved rules immutable (DB trigger); compact *membership claims* can never be a basis (DB CHECK).
- **Readiness matrix** (`/credentialing/readiness`): practitioner × jurisdiction, ALLOW / REVIEW / BLOCK with reason codes and evidence IDs; fail-closed (no approved rule → "No approved policy"). Payer readiness is site-specific.
- **Payers & Plans** and **enrollments** per provider × plan × site; approval needs confirmation + effective dates and second-person verification.
- **Credentialing cases** (`/credentialing/cases`): queue with owner/due/status; "Link task" creates a project task, and completing the case moves that task to Done.
- **Deadline job** (`credentialing.deadlines`, daily in the worker; `POST /api/v1/jobs/credentialing-deadlines`): expires past-due evidence and creates one renewal task per 90/60/30-day threshold (idempotent across reruns and concurrent workers).
- **Scheduling (synthetic demo, `SCHEDULING_MODE=DEMO_ONLY`)**:
  - `/scheduling/find`: server-side search (working hours, time off, closures, rooms, existing bookings incl. buffers, notice/horizon) grouped by day and provider, every time with "why offered" and zone label; one click holds a time.
  - `/scheduling/appointments/new`: hold countdown, synthetic patient picker/creator, patient location at visit time (proposed/verified), idempotent booking; manual entry flags DST-nonexistent and repeated times.
  - `/scheduling/calendar`: day (by provider) and week views, site/provider filters, zone + DST notice, legend, accessible agenda table; drawer (`?appt=`) with details, append-only history, check-in/complete/no-show, cancel with reason, atomic reschedule.
  - `/scheduling/setup`: appointment types, rooms, weekly working hours, time off/closures (impacted bookings flagged, never auto-cancelled).
  - **Eligibility (Phase 5)**: every search result, hold, booking, reschedule, check-in and location change is decided by one deterministic EligibilityService (ADR-0010) — patient location at visit time, verified evidence, approved DEMO rules, site-specific payer enrollment, EHR source-of-truth mode and capacity. Find Appointment shows eligible times by default and lists providers who are "not offered" with the reason; the new-appointment page previews the same decision; REVIEW results can only be saved as PENDING; the drawer shows the evaluation (stale after 15 min), history, re-check, confirm, check-in with location confirmation, and location change.
  - **Waitlist** (`/scheduling/waitlist`): requests with windows; "Find & offer" holds an eligible time until the offer expires; acceptance re-checks and books; lost eligibility invalidates the offer.
  - **Follow-up tasks** in the auto-created "Eligibility follow-ups" project when license/payer reasons stop a booking (no patient data).
- **Revenue cycle (Phase 6, synthetic claim refs `SYN-…` only — not a clearinghouse)**:
  - `/rcm/queues`: four queues (denial initiative, aging follow-up, credentialing-linked payer issues, billing quality) with live counts that link to exactly those rows; filters (status, owner, next-action due, age bucket, priority, type, payer, case #/claim ref); owner workload; supervisors select cases and **bulk-assign all-or-nothing**, with an **Undo** banner.
  - `/rcm/cases/[id]`: claim / release / assign, record follow-ups (payer call, portal check, appeal…) with next action + due date (queue default), edit priority/next action, **escalate** (to queue lead or chosen supervisor, in-app notification), resolve/close with note, reopen, link a project task (resolving completes it), live status of a linked credentialing case. Append-only timeline + audit.
  - Analysts (`rcm.edit`) work unassigned/their own cases; supervisors (`rcm.manage`, new permission) assign, bulk-assign, undo, configure queues. Department-scoped.
- **Operations dashboard** (`/dashboard`) and **reports** (`/reports`, `/reports/[metric]`): 14 SQL metrics across scheduling, credentialing, RCM and projects; each tile number equals its drill-down's row count (same query), with definitions, sources, filters applied/ignored, date window, computed-at, source last-changed and an EHR-not-current warning. Filters: site, department, provider, from/to.
- **Notifications** (`/notifications`, unread badge in the sidebar): due-soon/overdue RCM next actions and project tasks, assignments and escalations, delivered through a Postgres **transactional outbox** by the worker; exactly-once per due date. In-app only (no email/SMS).
- **Worker & Outbox** (`/admin/worker`, org admins): job/outbox status counts, failed/dead rows with **Replay**, "Run reminder scan now".
- **EHR integration (Phase 7, synthetic simulator only)**: per-site source of truth (DEMO / EHR_MASTER / READ_ONLY / STANDALONE_APPROVED). At the EHR_MASTER site (NEDC) bookings are sent to the EHR through the outbox and become Confirmed only when the EHR accepts them; outage/stale → drafts only and 503 on confirm; retries never duplicate; EHR-only busy times are imported and not offered; EHR-side cancellations/moves raise conflicts. **Integration Health** (`/admin/integrations`): mode, connection label (never "connected" for an unverified vendor), capability verification table, freshness, last success/error, EHR-state counts, conflicts with Accept EHR / Retry / Resolve / Dismiss, write queue with Replay, sync-run log, rehearsal controls for the simulator.
- **PHI readiness** (`/admin/compliance`): verdict banner (NOT APPROVED FOR REAL PHI), 19-item evidence checklist with dual control, 10 automated checks, drill history.
- **MFA** (`/account/security`, `/login/two-factor`): TOTP + 8 backup codes; required for privileged roles outside synthetic modes (opt-in with `REQUIRE_MFA_FOR_PRIVILEGED=true`).
- **Downtime schedule** (`/scheduling/downtime`): printable paper schedule per site/day (audited). **Drills**: `pnpm ops:restore-drill` (encrypted backup + verified restore) and `pnpm ops:rehearsal` (scripted synthetic clinic day, 9 assertions).
- **Recurring tasks** + **worker** (`pnpm worker`): Postgres job queue, dedupe keys, `SKIP LOCKED`, backoff, dead-letter, stale-lock recovery.

## Verification (commands actually run, 2026-10-21, Next.js 16.4.2)
| Command | Result |
|---|---|
| `pnpm lint` / `pnpm format:check` | ✅ 0 errors / 0 warnings; formatted |
| `pnpm typecheck` | ✅ all 14 packages |
| `pnpm test` | ✅ 80/80 unit |
| `pnpm test:integration` | ✅ 127/127 (real PostgreSQL 16; +11 EHR write-through/sync/reconciliation, +7 compliance incl. full clinic-day rehearsal) |
| `pnpm db:reset` (migrations 0000–0012 + all seeds incl. Phase 7) | ✅ |
| `pnpm build` | ✅ |
| `pnpm test:e2e` (fresh `db:reset`, `pnpm start` with `AUTH_SIGNIN_MAX_PER_MIN=1000`) | ✅ 40/40 (incl. 3 Phase 7 specs: EHR-01/02 + Integration Health, readiness dual control, MFA) |
| `pnpm ops:restore-drill` (with `BACKUP_ENCRYPTION_KEY`) | ✅ PASS — 0 mismatches, audit trigger restored, RTO ≈ 1 s |
| `pnpm ops:rehearsal` | ✅ PASS 9/9 |
| `pnpm security:scan` | ✅ no findings · `pnpm audit --prod`: 6 dev-tooling advisories (risk register #6) |
| Windows one-click (`START-WINDOWS.cmd`) | ✅ Phases 0–2 verified on the user's PC; later phases delivered via the same script |
| CI workflow (`.github/workflows/ci.yml`) | written, **not yet executed** (no GitHub repo connected) |

## Issues found and fixed during verification
- Pre-hydration native submit of React forms would have been a GET (login form → password in the URL). All client-handled forms are now `method="post"`.
- Board columns overflowed a 1440 px laptop screen (Done column off-screen during drag) → min column width 200 px.
- Sidebar "Sign out" was pushed below the fold by the synthetic banner → sticky banner + offset sidebar.
- Windows: migrate/seed "is main module" check failed on `C:\` paths → `pathToFileURL`.
- Drizzle renders `${column}` unqualified in single-table selects, so correlated subqueries compared the inner table's `id` with itself (provider evidence counts were empty) → `qualified()` helper + regression test.
- Next.js 15.5 intermittently dropped navigation/refresh commits (12–30 % in loops) → upgraded to Next 16.4.2 (ADR-0008) plus a confirmed-refresh fallback.
- E2E tests that navigated before a PATCH finished (case → task sync) now wait for the response.
- Raw SQL with JS `Date` parameters fails under postgres.js → ISO strings with `::timestamptz` casts.
- Hold-expiry sweep and conflict alternatives used the wall clock instead of the injected `now` → threaded `now` through.
- Explain endpoint counted the caller's own hold as a conflict → `holdId` excluded from the capacity check.
- Task drawer: a comment/checklist reload overwrote field edits in progress (flaky e2e) → edits are preserved; only save/reload resets.
- Test isolation: integration tests that read the shared job queue now park other suites' jobs; event lists are ordered explicitly.
- Phase 6: date defaults in the credentialing forms used the **UTC** date (after 8 pm Eastern a new license got tomorrow's effective date → readiness not yet effective) → local calendar date; e2e date helpers likewise use the org time zone.
- Phase 6: a keyboard move on the board re-mounted the card and dropped focus → focus follows the card to its new column.
- Phase 7: the booking module's legacy `EHR_WRITE_NOT_CONNECTED` review stayed for sites without a verified connection; write-through ALLOW is only possible with verified capabilities and a healthy health check.
- Phase 6: a demo user name collided with an existing seeded approver → new RCM supervisor "Taylor Nguyen (Demo)".

## Known limitations / open items
1. **Invites are simulated** (code shown on screen, no email) — ADR-0006. Must change before any cloud deployment.
2. **No MFA/passkeys** yet — required before PHI (Better Auth plugin available).
3. CSP still allows inline scripts (Next.js runtime) — move to nonces in Phase 8.
4. No OpenAPI document generated yet (API documented in `docs/API.md`).
5. Rate limiting is in-memory per process (single instance only).
6. Board "calendar" view uses due dates only (no start dates/durations).
7. Saved filters per user and global search are not implemented.
8. **No real EHR** — only the synthetic simulator; a vendor adapter needs vendor docs, sandbox access and capability sign-off. Scheduling is a **synthetic demo** using DEMO policy rules. RCM is an internal work queue on synthetic claim references — no claim lines, 835/837, clearinghouse or payer connectivity.
9. **License policy rules are demo content, not verified law.** A real deployment needs counsel-reviewed rules entered and approved by two people.
10. Credential evidence is entered manually; there is no primary-source (NPDB/state board/NURSYS) integration.
11. E2E tests mutate the demo data: run `pnpm db:reset` before a full run.
12. Scheduling gaps: no group/capacity>1 visits, no equipment reservations UI, no patient notifications, working-hours list is long (no per-provider filter yet).
13. Expired holds are released by `pnpm worker` (or on the next conflicting booking). Without the worker an abandoned hold blocks its slot until then.
14. Eligibility gaps (ADR-0010): no temporary-practice/continuity exception records, no supervision/age/service restrictions, provider's own location is taken from the profile (not confirmed per visit), no EHR adapter (EHR_MASTER sites can only save pending drafts), rescreen runs hourly + on credentialing changes (not on PTO/schedule edits).
16. Reports are live queries (fine at demo scale; no materialized snapshots or CSV export yet). No automated axe scan yet (keyboard e2e only). Notifications are in-app only; no digest/quiet-hours preferences.
17. RCM auto-assignment rules (round-robin/by policy) are not built — assignment is manual or bulk.
15. Legacy Phase 4 demo bookings on an existing database show "Not evaluated" until re-checked or rescreened (the worker does this hourly).

## Next 3 tasks
1. **Prompt 08 — production hardening** (`prompts/08_PRODUCTION_HARDENING.md`): nonce CSP, slim production image, vitest 4 upgrade, shared rate limiting, observability.
2. External PHI-readiness tasks (docs/compliance/READINESS_REPORT.md) — owned by the organization, not the software.
3. Generate OpenAPI from Zod schemas; push to a private GitHub repo and get CI green.

## Accepted ADRs
0001 modular monolith · 0002 single-org SaaS-ready · 0003 appointment source (proposed) · 0004 DB concurrency · 0005 stack selection · 0006 local invite simulation · 0007 credentialing model · 0008 Next.js 16 upgrade · 0009 scheduling model · 0010 eligibility service · 0011 RCM, reconciling reports, notification outbox · 0012 EHR adapter, fail-closed write-through, PHI readiness · 0003 updated (accepted for synthetic build)
