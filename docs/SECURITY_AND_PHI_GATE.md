# Security & PHI gate

**Current decision: NO-GO for any real patient data.** The authoritative checklist is `specs/GO_LIVE_CHECKLIST.md`; every item is `NOT STARTED`.

## Controls implemented in code (Phases 0–2)
- Server-side authorization on every use-case; org from session only; deny-by-default permissions; 404 for out-of-scope objects.
- Better Auth: httpOnly SameSite=Lax session cookies (Secure when served over HTTPS), 8 h sessions, sign-up disabled, password ≥ 12, sign-in rate limit (10/min/IP default).
- Same-origin check on state-changing API requests; 64 KB JSON body limit.
- Security headers: CSP (no third-party origins), X-Frame-Options DENY, nosniff, Referrer-Policy no-referrer, Permissions-Policy, COOP.
- Append-only audit log with ALLOW/DENY outcomes and request ids; metadata limited to IDs/field names.
- Redacting structured logger; no request bodies, tokens or names in logs.
- Synthetic-mode banner on every page; seed/reset refuse to run outside DEVELOPMENT/DEMO_SYNTHETIC.

## Known gaps (must close before any PHI)
- No MFA/passkeys yet (Better Auth plugin available) — required before PHI.
- Invites are shown on screen, not emailed (ADR-0006).
- CSP allows `'unsafe-inline'` scripts (Next.js inline runtime) — move to nonce-based CSP.
- No PostgreSQL RLS defense-in-depth; no field-level encryption (no sensitive fields exist yet).
- Rate limiting is in-memory per process (fine for one instance only).
- No backup/restore automation; no SAST/dependency scanning in CI yet.
