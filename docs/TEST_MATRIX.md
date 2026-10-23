# Test matrix — what is automated today

| ID (blueprint/spec) | Scenario | Where | Status |
|---|---|---|---|
| SEC-01 | Forged `organizationId` in body ignored | `security.int.test.ts`, `e2e/api-security.spec.ts` | ✅ automated |
| — | Cross-org read/update/link of site, project, task, dependency, owner → 404/422 (synthetic 2nd org) | `security.int.test.ts` | ✅ |
| — | Stale/suspended membership → no context; role change effective next request | `security.int.test.ts` | ✅ |
| — | Unauthorized site mutation (scheduler) → 403 + DENY audit, no values in metadata | int + e2e | ✅ |
| — | Site-scoped manager edits only own site | `security.int.test.ts` | ✅ |
| — | Role escalation: grant > own perms, self-change, scoping org-wide-only role, other org's role | int + e2e | ✅ |
| — | Invite single-use; scoped grant applied | int + e2e | ✅ |
| — | Audit append-only (UPDATE/DELETE blocked by trigger) | `security.int.test.ts` | ✅ |
| PROJ-01 | Board move (keyboard control + drag/drop) persists across reload | `e2e/board.spec.ts`, `projects.int.test.ts` | ✅ |
| PROJ-02 | Dependency cycle rejected (direct, transitive, concurrent) | int + e2e | ✅ |
| — | Blocked task cannot be Done; UI rolls back with reason | int + e2e | ✅ |
| — | Duplicate retry with Idempotency-Key → one task (sequential + 5 concurrent) | int + e2e | ✅ |
| OPS-01 (analogue) | Recurring generation idempotent across repeated + concurrent runs | `projects.int.test.ts` | ✅ |
| — | Job queue: dedupe, exactly-once across 3 workers, backoff, dead-letter | `jobs.int.test.ts` | ✅ |
| — | Version conflicts (site, project, task) → 409 | int | ✅ |
| — | Department-scoped visibility (RCM sees only BILL) | int + e2e | ✅ |
| — | 401 unauthenticated, 422 field details, malformed JSON, cross-origin 403 | e2e | ✅ |
| LIC-01/02 | VA-only verified physician; patient physically in MD | `readiness.unit.test.ts` (fixture B) + e2e matrix | ✅ readiness level (booking in Phase 5) |
| LIC-03 | DC location has no approved rule | unit (fixture C) + e2e (`cell-D-DC`) | ✅ readiness level; check-in re-evaluation is Phase 5 |
| LIC-04 | IMLC membership claim ≠ MD license | unit + DB CHECK (claim can't be a rule basis) | ✅ |
| LIC-05 / LIC-06 | RN multistate allowed only with explicit home-state rule; never for APRN | unit + e2e (`cell-B2-MD`) | ✅ |
| LIC-07 | Psychologist without verified APIT | unit (fixture E) | ✅ |
| LIC-08 / LIC-09 | Expired (day after) / suspended authority | unit (fixture G) + int + e2e (suspend → Blocked) | ✅ |
| LIC-10 (policy) | No approved / stale rule → review, `canConfirm=false` | unit (fixture H) | ✅ |
| LIC-10 (payer) / CRED-02 / fixture F | Payer approved at Site A only | unit + int + e2e | ✅ |
| LIC-11 | Provider physically outside rule's permitted states | unit | ✅ |
| CRED-01 | Submitter cannot self-verify (dual control) | int + e2e | ✅ |
| SEC-02 | Specialist/scheduler cannot publish a rule; author cannot approve own rule | int + e2e (HTTP 403) | ✅ |
| OPS-01 | Credential deadline job: one task per threshold, idempotent across reruns + concurrent runs | `credentialing.int.test.ts` | ✅ |
| — | Approved rules immutable; verification history append-only (DB triggers) | int | ✅ |
| — | Phase 3 exit: readiness changes when evidence is verified / suspended / payer approved+verified | int + e2e | ✅ |
| SCH-01 | Two (and five) concurrent bookings, same provider/time → exactly one | `scheduling.int.test.ts` (Promise.all) + `e2e/scheduling.spec.ts` (HTTP 201/409) | ✅ |
| SCH-02 | Room conflict (sequential → NO_ROOM, concurrent → DB exclusion) | int | ✅ |
| — | Buffer overlap reserved (10:05 blocked, 10:10 ok) | unit + int | ✅ |
| SCH-03 / SCH-04 | DST gap rejected/omitted; fall-back ambiguity shown with explicit offsets; 23/25-h calendar days | unit + int + e2e (UI messages) | ✅ |
| SCH-05 | Failed reschedule leaves original unchanged; parallel rebooking → one wins | int + e2e (drawer reschedule) | ✅ |
| SCH-06 | Cancel releases reservations; slot rebookable; cancel idempotent | int + e2e | ✅ |
| SCH-07 | Stale hold blocks until explicitly released; worker idempotent across 3 concurrent runs; owner cannot use expired hold | int | ✅ |
| — | Unauthorized booking: wrong site (403 + DENY audit), no scheduling.manage, other org, unauthenticated; demo flag off → BOOKING_DISABLED | int + e2e | ✅ |
| — | Idempotency-Key replay; append-only appointment history; reservations cannot be deleted | int + e2e | ✅ |
| LIC-01/02/04 | VA-only physician; VA-home patient physically in MD; IMLC claim | `eligibility.unit.test.ts` + `eligibility.int.test.ts` (409, persisted attempt, DENY audit, one task) + e2e (not offered) | ✅ booking level |
| LIC-03 / fixture C | Booked MD, patient in DC at check-in → stopped, PENDING, evaluation + event | unit + int | ✅ |
| LIC-05/06 | RN multistate with explicit home-state rule; never for APRN | unit | ✅ |
| LIC-07 | Psychologist without verified APIT → REVIEW; verified APIT → ALLOW | unit | ✅ |
| LIC-08 / fixture G | Expired (Nov 1 after Oct 31) / suspended → BLOCK; suspension after booking → rescreen → NEEDS_RESCHEDULE | unit + int | ✅ |
| LIC-09 / fixture H | No rule, overdue rule review, unverified evidence → REVIEW | unit | ✅ |
| LIC-10 / fixture F | Payer approved at site 1 only → site 2 BLOCK; self-pay ALLOW | unit + int | ✅ |
| LIC-11 | Provider physically outside the rule's permitted states → REVIEW | unit | ✅ |
| LIC-12 / fixture K | Video with no patient location → REVIEW LOCATION_UNKNOWN | unit + int | ✅ |
| fixture J | EHR master stale → REVIEW (saved as pending draft); read-only → BLOCK | unit + int | ✅ |
| fixture I | Two schedulers race for one eligible slot → one booking, one 409 | int + e2e | ✅ |
| — | Search, explain endpoint and booking derive the same decision; stale evaluation reported; re-check persists fresh | int | ✅ |
| — | Waitlist: eligible matches only, offer holds + expires (idempotent), accept books, invalidated on lost eligibility | int + e2e | ✅ |
| SEC-02 | Scheduler cannot publish policy (403 + DENY audit); approval audited and queues rescreen | int + e2e | ✅ |
| RCM-01 | Create case, assign owner, add action → counts and audit reflect real rows | `rcm.int.test.ts` + `e2e/rcm.spec.ts` (create → claim → follow-up → escalate → notification) | ✅ |
| — | RCM assignment authorization: analyst claim vs assign-others (403 + DENY audit), assignee must hold rcm.edit in scope, take-over blocked | `rcm.int.test.ts` + e2e (HTTP 403 bulk) | ✅ |
| — | Department scoping (other department's queue → 404 for RCM staff; other org → 404) | int | ✅ |
| — | Bulk assign all-or-nothing (scope, assignee permission, stale versions); batch audit; one notification; undo; undo blocked after later edits | int + e2e (keyboard) | ✅ |
| — | No duplication on retry (Idempotency-Key replay, one open case per claim ref + type) | int | ✅ |
| — | Workflow link to projects (task created once; RESOLVED → task DONE) and credentialing link shows live status | int | ✅ |
| — | Append-only RCM timeline (UPDATE/DELETE blocked by trigger) | int | ✅ |
| — | Aggregate reconciliation: every dashboard tile = its drill-down total = distinct row ids, with/without site and date filters; RCM metrics = independent SQL; queue cards = list filters | `reports.int.test.ts`, `rcm.int.test.ts`, e2e (tile → report total) | ✅ |
| — | Scheduling + credentialing + RCM + projects roll up in one dashboard; scheduler sees only own site; analyst sees only RCM/projects; other org sees 0 | `reports.int.test.ts` | ✅ |
| — | Outbox reminders idempotent (repeat scans/dispatches → one per due date; new due date re-arms); unassigned overdue → queue lead | int | ✅ |
| — | Worker failure → FAILED → DEAD; replay (admin only, audited) delivers exactly once even after a crash-after-deliver; stale PROCESSING recovered; DEAD job replay | int | ✅ |
| A11Y | Keyboard-only: board create + move (focus follows card, live announcement); find → hold → patient → book wizard; calendar drawer Enter/Escape + cancel; RCM bulk assign + undo | `e2e/a11y-keyboard.spec.ts` | ✅ |
| EHR-01 | Authoritative EHR unreachable → no local confirmation; draft only; confirm → 503 | `ehr.int.test.ts`, `e2e/phase7.spec.ts` (HTTP 409 EHR_UNAVAILABLE), rehearsal | ✅ |
| EHR-02 | Timeout after the EHR wrote → retry → exactly one external appointment and one mapping | `ehr.int.test.ts`, rehearsal | ✅ |
| — | DB CHECK: CONFIRMED impossible before EHR acceptance | `ehr.int.test.ts` | ✅ |
| — | Stale master schedule → fail closed; sync restores | `ehr.int.test.ts` | ✅ |
| — | Writes failing past max attempts → FAILED + conflict; Retry recovers; permanent errors DEAD at once | `ehr.int.test.ts` | ✅ |
| — | Patient mapping: missing / ambiguous identifier → conflict, never guessed | `ehr.int.test.ts`, e2e | ✅ |
| — | Reschedule (ETag update) and cancel written to the EHR | `ehr.int.test.ts` | ✅ |
| — | EHR-only busy time imported, not offered, idempotent, released on cancel | `ehr.int.test.ts`, rehearsal | ✅ |
| — | EHR-side cancel / move / delete → conflicts (deduped), Accept EHR without a second cancel; reconciliation idempotent | `ehr.int.test.ts`, e2e (UI) | ✅ |
| — | Unverified vendor never shown connected; simulator controls need integrations.manage | int + e2e | ✅ |
| — | PHI readiness: default NOT APPROVED; dual control in app (403 + DENY audit) and DB; synthetic mode keeps NOT APPROVED even with all items approved | `compliance.int.test.ts`, e2e | ✅ |
| — | MFA enrol/verify/sign-in second factor/disable; required for privileged roles outside synthetic modes | e2e, `compliance.int.test.ts` | ✅ |
| OPS-02 | Backup restore drill (encrypted, verified) | `pnpm ops:restore-drill` (PASS recorded) | ✅ manual command |
| — | Synthetic clinic-day rehearsal (9 assertions) | `compliance.int.test.ts` + `pnpm ops:rehearsal` | ✅ |
| SEC (Phase 8) | Privilege-escalation matrix: every mutating route (auto-discovered) → 401 unauthenticated; Auditor never 2xx/5xx and never state-revealing; scheduler never 2xx on admin routes; no ALLOW mutation audited | `e2e/authz-matrix.spec.ts` | ✅ |
| — | Least-privilege runtime DB role: whole e2e suite as `projectos_app`; cannot disable audit triggers | e2e run (RC SEC-DBROLE) | ✅ manual run |
| — | Nonce CSP + release info + DB URL composition | `apps/web/test/hardening.unit.test.ts` | ✅ |
| — | DB-backed sign-in rate limit survives a restart | `rl.sh` evidence (RC SEC-RL) | ✅ manual run |
| A11Y | axe WCAG 2.1 A/AA, 0 serious/critical on 22 critical pages | `e2e/a11y-axe.spec.ts` | ✅ |
| — | No patient identity / credential in web, worker or e2e logs | `pnpm security:scan-logs` (CI after e2e) | ✅ |
| OPS-03 | Concurrency: 20 same-slot bookings → exactly 1 × 201; p95 search/save/page + JS budgets | `pnpm ops:load-test` | ✅ (sandbox scale) |
| OPS-04 | Clean-deployment restore: encrypted dump → new DB → migrate → server + sign-in + probes + worker tick | `pnpm ops:clean-restore` | ✅ |
| OPS-05 | Migration rollback: SQL error and destructive migration → restored, data identical, grants intact | `pnpm ops:migration-drill`, `pnpm release:migrate` | ✅ |
| INF | Terraform validate + mocked-provider plans + PHI gate preconditions; checkov | `tofu validate`, `tofu test` (4/4), checkov 313/0 | ✅ (not applied) |
| SEC (RLS) | Every tenant table has `org_isolation`; bound role sees 0 foreign rows in 60 tables, cannot update/delete/insert across orgs, sees nothing when unbound | `packages/core/test/rls.int.test.ts` + e2e 45/45 as the RLS-bound role | ✅ |
