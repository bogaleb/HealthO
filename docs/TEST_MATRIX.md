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
| LIC-12, EHR-*, RCM-01 | Booking-time eligibility, EHR, RCM | — | ⏳ Phases 5–7 |
| OPS-02 | Backup restore drill | — | ⏳ Phase 8 |
