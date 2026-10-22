# REST API v1 (implemented subset)

All endpoints except health and invite acceptance require a Better Auth session cookie. Responses: `{ "data": … }` on success; errors use the blueprint format `{ "error": { code, message, details[], requestId } }`. Status codes: 401 unauthenticated, 403 forbidden / cross-origin, 404 not found or not visible, 409 conflict / version conflict, 422 validation, 500 with request id only.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | /api/v1/health/live | public | liveness |
| GET | /api/v1/health/ready | public | DB + migration count, 503 if not ready |
| GET | /api/v1/me | member | session org, grants, effective permissions |
| GET/POST | /api/v1/sites | read: member · create: org-wide `sites.manage` | |
| GET/PATCH | /api/v1/sites/:id | update: `sites.manage` for that site | `version` required |
| GET/POST | /api/v1/departments, /api/v1/teams | create: org-wide `sites.manage` | |
| GET | /api/v1/members | member | display-name directory for pickers (no emails) |
| GET | /api/v1/users?departmentId&status | `users.manage` | memberships + grants |
| PATCH | /api/v1/users/:membershipId | `users.manage` | suspend/reactivate (not self) |
| PUT | /api/v1/users/:membershipId/roles | `users.manage` | replace grants; anti-escalation; not self |
| GET/POST | /api/v1/auth/invite | `users.manage` | POST returns one-time token once |
| POST | /api/v1/invites/accept | public | `{ token, password }` |
| GET/POST | /api/v1/roles | GET member · POST `org.manage` | |
| PATCH | /api/v1/roles/:id | `org.manage` | custom roles only |
| GET | /api/v1/audit-events | org-wide `audit.read` | filters: outcome, action, resourceType, from, to, page |
| GET/POST | /api/v1/projects | `projects.read` / `projects.edit` in scope | POST accepts `templateId` |
| GET/PATCH | /api/v1/projects/:id | read / edit in scope | |
| POST | /api/v1/projects/:id/milestones | edit | |
| GET | /api/v1/projects/:id/board | read | |
| GET/POST | /api/v1/projects/:id/recurring | read / edit | |
| GET/POST | /api/v1/tasks | read / edit | GET filters: projectId,status,priority,ownerUserId,label,q,dueFrom,dueTo,open,mine,page,pageSize(≤100). POST honors `Idempotency-Key` (201 new, 200 + `replayed:true`) |
| GET | /api/v1/tasks/search?q&exclude | read | dependency picker |
| GET/PATCH/DELETE | /api/v1/tasks/:id | read / edit | PATCH needs `version` |
| POST | /api/v1/tasks/:id/move | edit | `{ status, beforeTaskId?, version }`; 422 `TASK_BLOCKED` |
| POST | /api/v1/tasks/:id/comments | edit | |
| POST, PATCH/DELETE | /api/v1/tasks/:id/checklist[/:itemId] | edit | |
| POST, DELETE | /api/v1/tasks/:id/dependencies[/:depId] | edit | 422 `DEPENDENCY_CYCLE` |
| POST | /api/v1/jobs/recurring | org-wide `org.manage` | run generator now (idempotent) |
| **Credentialing (Phase 3)** | | | |
| GET/POST | /api/v1/practitioners | `credentialing.read` / `credentialing.edit` (org-wide or site) | GET filters: profession, state, siteId, q, includeInactive |
| GET/PATCH | /api/v1/practitioners/:id | read / edit | PATCH needs `version`; replaces site/specialty/service links when provided |
| GET/POST | /api/v1/practitioners/:id/authorities | read / edit | POST creates a **DRAFT**; profession must match the provider |
| GET | /api/v1/practitioners/:id/readiness?date | read | license (IN_PERSON + VIDEO) × jurisdiction and payer readiness |
| POST | /api/v1/authorities/:id/submit-review | edit | DRAFT/REJECTED → SUBMITTED |
| POST | /api/v1/authorities/:id/approve | `credentialing.approve`; dual control | SUBMITTED → VERIFIED with primary-source fields |
| POST | /api/v1/authorities/:id/reject | approve | SUBMITTED → REJECTED (reason required) |
| POST | /api/v1/authorities/:id/status | approve | SUSPENDED / REVOKED (reason required) |
| GET | /api/v1/authorities/:id/history | read | append-only verification history |
| GET/POST | /api/v1/policy-rules | read: credentialing.read or policy.publish · create draft: org-wide credentialing.edit or policy.publish | multistate/APIT bases require `acceptedHomeStates` |
| POST | /api/v1/policy-rules/:id/approve | org-wide `policy.publish`; dual control | supersedes the prior approved version |
| POST | /api/v1/policy-rules/:id/retire | `policy.publish` | |
| GET/POST | /api/v1/payers, POST /api/v1/payer-plans | read / org-wide edit | |
| POST | /api/v1/enrollments | edit | per provider × plan × site (site must be affiliated) |
| PATCH | /api/v1/enrollments/:id | edit | APPROVED needs `approvedOn` + `effectiveOn`; any change clears verification |
| POST | /api/v1/enrollments/:id/verify | approve; dual control | |
| GET/POST | /api/v1/credentialing/cases | read / edit | GET filters: status, caseType, ownerUserId, practitionerId, open |
| PATCH | /api/v1/credentialing/cases/:id | edit | COMPLETED moves the linked project task to Done (`taskSync` in response) |
| POST | /api/v1/credentialing/cases/:id/link-task | edit + project edit | creates a project task (idempotent per case) |
| GET | /api/v1/credentialing/readiness?modality&date&profession | read | full matrix (license + payer) with reasons and evidence IDs |
| GET | /api/v1/credentialing/reference | read | sites, specialties, services |
| POST | /api/v1/jobs/credentialing-deadlines | org-wide `org.manage` | expiry + 90/60/30-day renewal tasks (idempotent; worker runs daily) |
| **Scheduling (Phase 4–5 — synthetic demo)** | | | |
| GET | /api/v1/scheduling/reference | scheduling.read | sites (scoped), appointment types, providers, rooms, services |
| POST | /api/v1/scheduling/search | scheduling.read | `{appointmentTypeId, modality, siteId?, practitionerId?, fromDate, days≤14, patientState?, payerPlanId?, show=eligible\|all}` → slots with eligibility per slot + `notOffered` explanations |
| POST | /api/v1/scheduling/evaluate | scheduling.read at site | explain one candidate (not persisted): decision, flags, rule version, evidence |
| GET | /api/v1/scheduling/calendar?date&view=day\|week&siteId&practitionerId | scheduling.read | day boundaries in the site/org zone (23/25-h DST days) |
| GET/POST | /api/v1/appointment-types, PATCH /:id | read / org-wide `scheduling.configure` | |
| GET/POST | /api/v1/rooms | read / `scheduling.configure` at site | |
| GET/POST | /api/v1/schedule-templates, DELETE /:id | read / configure at site | DELETE deactivates (history kept); overlapping blocks → 409 |
| GET/POST | /api/v1/schedule-exceptions, DELETE /:id | read / configure | PTO, CLOSURE, BLOCK; response lists impacted appointments (never auto-cancelled) |
| GET/POST | /api/v1/patients?q, GET /:id | patients.read (+ scheduling.manage to create) | ≥2 chars, ≤20 rows; create = synthetic only |
| POST | /api/v1/appointments/holds | scheduling.manage at site | expires after SCHEDULING_HOLD_MINUTES; 409 SLOT_CONFLICT |
| GET/DELETE | /api/v1/appointments/holds/:id | owner or manage | release |
| POST | /api/v1/appointments | scheduling.manage at site | `Idempotency-Key`; optional `holdId`, `payerPlanId`, `acceptPendingReview`; 403 BOOKING_DISABLED; 409 SLOT_CONFLICT / HOLD_EXPIRED / ELIGIBILITY_REVIEW; 422 SLOT_UNAVAILABLE / ELIGIBILITY_BLOCKED (details carry flag codes + `ELIGIBLE_ALTERNATIVE`s) |
| GET/PATCH | /api/v1/appointments/:id | read / manage | PATCH = atomic reschedule `{version, startAt, reason, practitionerId?, siteId?}` |
| POST | /api/v1/appointments/:id/cancel | manage | `{version, reason}`; releases reservations; idempotent; returns `waitlistCandidates` count |
| POST | /api/v1/appointments/:id/status | manage | COMPLETED, NO_SHOW (after start) |
| POST | /api/v1/appointments/:id/check-in | manage | `{version, patientLocationState?, locationConfirmed}` (required for video/audio); re-evaluates; non-ALLOW stops check-in (state committed) |
| POST | /api/v1/appointments/:id/confirm-location | manage | record changed/confirmed patient location and re-check immediately |
| POST | /api/v1/appointments/:id/recheck | manage | persist a fresh evaluation; REVIEW → PENDING, BLOCK → NEEDS_RESCHEDULE |
| POST | /api/v1/appointments/:id/confirm | manage | PENDING → CONFIRMED only if a fresh evaluation is ALLOW |
| GET/POST | /api/v1/waitlist, DELETE /:id | read / manage | staff-entered requests (date/weekday/time windows, location, payer) |
| GET | /api/v1/waitlist/:id/matches | read | eligible matching slots |
| POST | /api/v1/waitlist/:id/offer | manage | re-evaluates, holds the time until `expiresInMinutes` |
| POST | /api/v1/waitlist/offers/:offerId/accept \| decline | manage | accept books from the hold after re-evaluation (INVALIDATED if no longer eligible) |
| **Revenue cycle (Phase 6 — synthetic claim refs only)** | | | |
| GET/POST | /api/v1/rcm/queues, PATCH /:id | rcm.read / `rcm.manage` for the queue's department | queue cards with live counts (open, unassigned, overdue, due soon, >90 d, escalated, open balance, resolved 30 d); department immutable |
| GET | /api/v1/rcm/cases?queueId&category&status(=OPEN_ANY default,ALL)&priority&caseType&owner(me\|none\|uuid)&age(bucket\|over90)&due(overdue\|soon\|none)&payerId&siteId&q&page&pageSize | rcm.read (scoped) | `{total, items}`; same predicate as the queue counts |
| POST | /api/v1/rcm/cases | rcm.edit for the queue (assigning someone else needs rcm.manage) | `Idempotency-Key` replays; 409 `DUPLICATE_OPEN_CASE` for a second open case on the same claim ref + type; claim ref must match `SYN-…` |
| GET/PATCH | /api/v1/rcm/cases/:id | read / owner, unassigned+rcm.edit, or rcm.manage | PATCH `{version, status?, priority?, nextAction?, nextActionDue?, denialCode?, resolutionNote?}`; closing requires a note; RESOLVED completes the linked task (`taskSync`) |
| POST | /api/v1/rcm/cases/:id/actions | as above | follow-up `{type, note, nextAction?, nextActionDue?, status?}` (row-locked, append-only) |
| POST | /api/v1/rcm/cases/:id/assign | claim/release: rcm.edit · others: rcm.manage | `{version, ownerUserId\|null}`; assignee must hold rcm.edit in the case scope |
| POST | /api/v1/rcm/cases/:id/escalate | as PATCH | `{version, reason, escalateToUserId?}` (default queue lead; must hold rcm.manage); in-app notification |
| POST | /api/v1/rcm/cases/:id/link-task | as PATCH + projects.edit | idempotent per case |
| POST | /api/v1/rcm/bulk-assign | rcm.manage for every case | `{caseIds≤200, ownerUserId\|null, versions?}` all-or-nothing → `{batchId, assigned, unchanged}` |
| POST | /api/v1/rcm/assignments/:batchId/undo | rcm.manage | 409 if any case changed since the batch |
| GET | /api/v1/rcm/workload?queueId | rcm.read | open/overdue/>90/urgent per owner (+ unassigned) |
| **Reports & dashboard (Phase 6)** | | | |
| GET | /api/v1/dashboards/operations?siteId&departmentId&practitionerId&from&to | any of scheduling/credentialing/rcm/projects read | tiles per permitted domain with value, definition, applied/ignored filters, freshness |
| GET | /api/v1/reports | as above | metric definitions you may read |
| GET | /api/v1/reports/:metric?filters&page | the metric's permission | rows (50/page) + `total` from the same query, filters applied/ignored, source, `computedAt`, `sourceUpdatedAt`, EHR sites not current; audited |
| **Notifications & worker (Phase 6)** | | | |
| GET | /api/v1/notifications?unread=true | signed in | your own in-app notifications + unread count |
| POST | /api/v1/notifications/read | signed in | `{ids:[…]}` or `{all:true}` (own rows only) |
| GET | /api/v1/admin/worker | org.manage | job + outbox status counts, FAILED/DEAD/PROCESSING rows, last completion times |
| POST | /api/v1/admin/outbox/:id/replay, /api/v1/admin/jobs/:id/replay | org.manage | FAILED/DEAD → PENDING (audited; delivery is idempotent) |
| POST | /api/v1/jobs/notifications-scan | org.manage | run the reminder scan + one outbox dispatch now (the worker does this every tick) |

| **EHR integration & readiness (Phase 7 — synthetic simulator only)** | | | |
| GET | /api/v1/integrations/health | integrations.manage or scheduling.configure | per-site mode, connection label, capabilities (supported/verified), freshness, EHR-state counts, conflicts, outbox, sync runs |
| POST | /api/v1/integrations/connections | integrations.manage | `{siteId}` → connect the SYNTHETIC simulator |
| POST | /api/v1/integrations/connections/:id/sync \| /reconcile | integrations.manage | health + availability + change feed / reconciliation now (worker: every 5 min / hourly) |
| POST | /api/v1/integrations/connections/:id/simulator | integrations.manage | `{failureMode: NONE\|UNREACHABLE\|FAIL_WRITES\|TIMEOUT_AFTER_WRITE}` (simulator only) |
| POST | /api/v1/integrations/connections/:id/simulate | integrations.manage | `{kind: BOOK_IN_EHR\|CANCEL_IN_EHR\|MOVE_IN_EHR, appointmentId?, minutes?}` rehearsal helper |
| POST | /api/v1/integrations/conflicts/:id/resolve | integrations.manage | `{action: ACCEPT_EHR\|RETRY\|RESOLVED\|DISMISS, note?}` |
| PATCH | /api/v1/integrations/sites/:id/mode | integrations.manage | `{ehrSyncMode, ehrFreshnessMinutes?}`; STANDALONE_APPROVED refused in synthetic modes |
| GET | /api/v1/compliance/readiness | compliance.manage, org.manage or audit.read | verdict (NOT APPROVED FOR REAL PHI by default), counts, technical checks, drills |
| GET / PATCH | /api/v1/compliance/items, /:id | read / compliance.manage | PATCH `{action: UPDATE\|SUBMIT_EVIDENCE\|APPROVE\|REOPEN, version, …}`; submitter cannot approve (403) |
| GET | /api/v1/scheduling/downtime?siteId&date&days | scheduling.read at site | paper downtime schedule (audited `downtime.print`) |
| — | Better Auth `/api/auth/two-factor/*` | signed in | TOTP enable/verify/disable, backup codes (audited as `mfa.*`) |

EHR booking behaviour at an `EHR_MASTER` site: `POST /appointments` → `PENDING` + `ehrState: PENDING_CREATE` (CONFIRMED only after the EHR accepts);
EHR unreachable → 409 `ELIGIBILITY_REVIEW` with `EHR_UNAVAILABLE` (save as draft with `acceptPendingReview`); confirming a draft while the EHR is
unavailable/stale → **503** `SERVICE_UNAVAILABLE` / `EHR_UNAVAILABLE`. When `REQUIRE_MFA_FOR_PRIVILEGED=true` (or a non-synthetic APP_MODE), privileged users
without MFA get 403 `MFA_REQUIRED` on every API call.

Metric keys: `appointments-in-range`, `appointments-needing-attention`, `blocked-booking-attempts`, `licenses-expiring`,
`credentialing-cases-overdue`, `enrollments-not-ready`, `rcm-open`, `rcm-aged-over-90`, `rcm-next-action-overdue`, `rcm-unassigned`,
`rcm-credentialing-blocked`, `rcm-resolved`, `tasks-overdue`, `projects-at-risk`.

An OpenAPI document is not generated yet (tracked in PROGRESS.md).
