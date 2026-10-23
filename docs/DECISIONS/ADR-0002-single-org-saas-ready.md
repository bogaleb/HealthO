# ADR-0002 — Single organization now, SaaS-ready data model

**Status:** Accepted (Phase 0–1)

- Every domain table has `organization_id NOT NULL`; child tables reference parents through **composite foreign keys** `(organization_id, id)`, so the database itself rejects cross-organization links.
- The organization is resolved **only** from the session user's active membership (`loadAuthContext`). Zod schemas never accept `organizationId`; unknown keys are stripped, so a forged value is ignored (tested: SEC-01).
- Version 1 requires exactly one active membership per user. Org switching, provisioning and billing are deferred (Prompt 09).
- Out-of-scope reads return **404** (not 403) to avoid object enumeration; out-of-scope mutations of visible objects return 403 and are audited as DENY.
- Permissions are a fixed code catalog (`packages/shared/src/permissions.ts`). Roles are DB rows granting a permission set; a **role grant** may be org-wide or scoped to one site or one department. `org.manage`, `users.manage`, `audit.read`, `policy.publish` are org-wide-only.
- Grants are re-read from the DB on every request — suspension or role removal takes effect immediately.
- Anti-escalation: you can only grant permissions you hold org-wide; nobody can change their own roles.

**Done (2026-10-23):** PostgreSQL RLS as defense-in-depth — migration 0015, ADR-0015.
