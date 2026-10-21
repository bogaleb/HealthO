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

An OpenAPI document is not generated yet (tracked in PROGRESS.md).
