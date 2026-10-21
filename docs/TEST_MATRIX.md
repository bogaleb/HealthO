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
| SCH-*, LIC-*, EHR-*, RCM-01, CRED-* | Scheduling, licensure, EHR, RCM, credentialing | — | ⏳ Phases 3–7 |
| OPS-02 | Backup restore drill | — | ⏳ Phase 8 |
