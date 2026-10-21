# Prompt 01 — One-organization security foundation

Read `CLAUDE.md`, `MASTER_BLUEPRINT.md`, `/docs/PROGRESS.md`; inspect current implementation. Build Phase 1 as real vertical slices.

Implement organization-scoped memberships, departments, sites, teams, professional roles, and permissions. Seed one organization but retain non-null `organization_id` on all domain entities. Add a second *synthetic* organization in integration tests only to verify no cross-org reads/writes. Never accept trusted org ID from request body or URL. Build invites or safe local synthetic invite simulation as appropriate, admin user management, site CRUD, department filter controls and role permission gates enforced **on server** (not only hidden buttons).

Permissions: `org.manage`, `users.manage`, `sites.manage`, `scheduling.read`, `scheduling.manage`, `patients.read`, `credentialing.read`, `credentialing.edit`, `credentialing.approve`, `rcm.read`, `rcm.edit`, `projects.read`, `projects.edit`, `audit.read`, `policy.publish`. Support constrained scope by site/department. Add auditable allow/deny sensitive mutations without exposing sensitive data in logs. Add request auth error behavior (401/403/404), session security basics, server-side validation and negative tests.

Required browser UI: users/roles/sites pages, member invite dialog, real CRUD with loading/error/empty states. Tests: stale membership, forged organization ID, unauthorized site mutation, role escalation attempt, cross-tenant fixture. Run build, lint, typecheck and tests; update docs/PROGRESS.md.
