# Commercial SaaS expansion — readiness assessment and estimate (Phase 9)

_Date: 2026-10-23 · Status: **estimate only, implementation NOT started** (ADR-0014) · Gate: single-org pilot ≥ 60 days + written owner approval + counsel + named security owner_

## 1. Where the code stands today (measured on the current schema, migrations 0000–0014)

| Fact | Value | Meaning for multi-tenancy |
|---|---|---|
| Tables with `organization_id` | 60 of 70 | Domain data is tenant-scoped already |
| …of which `NOT NULL` | 57 | Nullable on `audit_events`, `jobs` and `ops_drills` because system events and drills are global |
| Foreign keys between domain tables | 80, all composite `(organization_id, id)` | The database itself rejects cross-tenant links |
| Single-column FKs to domain tables | **0** | No "forgot the org" join path at FK level |
| Tables with an index leading on `organization_id` | 47 | Most hot queries are already tenant-prefixed |
| Row-level security policies | **0** | Isolation is enforced in the application layer only. **Must change before tenant #2** |
| Global tables (no org column) | `users`, `sessions`, `accounts`, `verifications`, `two_factors`, `rate_limits`, `organizations`, `ehr_sim_*` | Identity is global (a person can belong to several orgs later); the `ehr_sim_*` tables are synthetic-only |
| Org resolution | `loadAuthContext`: exactly one ACTIVE membership, else no access | Safe now. Needs an "active organization" on the session for switching |
| Hard-coded org time zone (`America/New_York` / `ORG_TIMEZONE`) | 47 references in app code | Must become an organization setting (provisioning blocker) |
| Raw SQL usage | 41 source files use `sql` fragments; 33 `execute` calls | Each needs review under RLS (`SET LOCAL app.org_id`) and in the cross-tenant suite |
| Existing isolation tests | `security.int.test.ts` (synthetic second org, forged `organizationId`, cross-org 404s); `e2e/authz-matrix.spec.ts` (every mutating route, one org) | The matrix extends naturally to org A vs org B |
| Cross-org worker loops | notifications, RCM, reports, EHR sync and scheduling queries iterate all orgs | Need per-tenant fairness and tenant tagging in logs/metrics |

## 2. Work packages and estimate (one experienced full-stack engineer; ranges include tests and docs)

| # | Work package | Key acceptance criteria | Estimate |
|---|---|---|---|
| WP1 | **RLS defense-in-depth** on all 57 tenant tables: policies on `current_setting('app.org_id')`, set per transaction from the auth context; worker runs per-org transactions; a separate migration role bypasses RLS | A deliberately unscoped query returns 0 rows of another org (tested per table); app e2e 45/45 still green under RLS | 3–4 wk |
| WP2 | **Multi-membership + org switching** (flag `ORG_SWITCHING`): active org stored server-side on the session; switcher UI; re-load grants on switch; audit `org.switch`; URLs never carry the org | Switching cannot be forged (body/URL ignored); no data from org A visible after switching to B (e2e) | 1.5–2 wk |
| WP3 | **Provisioning + tenant admin** (flag `COMMERCIAL_REGISTRATION`, default OFF): create org (platform admin or self-serve when enabled); owner invite; role catalog per org; org settings (time zone, jurisdictions, branding); replace the 47 hard-coded zone references | New org starts empty with its own roles; nothing from the demo org leaks; the synthetic banner follows the org's mode | 2–3 wk |
| WP4 | **Billing + quotas** (flag `BILLING`): subscription provider through the transactional outbox (idempotent webhooks); plan limits (sites, staff, providers, EHR connections); grace period and read-only mode, **never** blocking an in-progress clinic day | Webhook replay produces exactly one state change; exceeding a quota blocks *new* objects only; no PHI sent to the billing vendor | 3 wk |
| WP5 | **Data lifecycle per tenant**: retention policies per data class; full tenant export (machine-readable); offboarding with legal hold; per-tenant logical restore; audit retention | Export → import into an empty stack reproduces the tenant; deletion leaves the audit trail required by policy | 3–4 wk |
| WP6 | **Central support with break-glass** (flag `SUPPORT_BREAK_GLASS`): platform staff identities separate from tenant memberships; access time-boxed, ticket-referenced, approved by a second person, visible to the customer's admin, read-only by default; full audit | No standing access; every session expires; the customer sees who looked and why | 2–3 wk |
| WP7 | **Malicious-tenant test suite** (§3) + an external multi-tenant pen test | All scenarios automated in CI; pen-test findings fixed or risk-accepted in writing | 2–3 wk + external |
| WP8 | **Scalability**: N-tenant load test (e.g. 20 tenants × the current single-org load), connection pooling (RDS Proxy or PgBouncer, transaction mode, compatible with `SET LOCAL`), per-tenant job fairness, noisy-neighbour rate limits per org | p95 budgets from Phase 8 hold at the target tenant count; one tenant's job flood cannot starve others | 1–2 wk |
| — | **Total engineering** | | **≈ 18–24 wk, about 21–29 wk with integration and hardening slack** (≈ 5–7 months for one engineer, ≈ 3–4 months for two) |

**Not engineering, and not estimated here (obtain quotes):**

- Counsel for the BAA template, terms, DPA and SLA, plus per-customer negotiation.
- The external multi-tenant penetration test.
- Billing-provider fees.
- An updated SOC 2/HITRUST-style assurance, if customers require it.
- Support staffing.

## 3. Malicious-tenant scenarios to automate (WP7)
1. **Forged identifiers:** org A sends org B's IDs (UUIDs harvested from errors, exports or URLs) to every GET and every mutating route. Expect 404 with no timing or size oracle. This extends `e2e/authz-matrix.spec.ts` to two orgs.
2. **Child-object IDOR:** reaching B's records through A's parent, for example a checklist item or dependency of B's task, or an offer on B's waitlist entry.
3. **Body injection:** `organizationId`, `orgId` and `tenant` in JSON bodies, query strings and headers are ignored (already tested for the single org).
4. **Switching abuse:** switching to an org without a membership; switching mid-transaction; a stale session after a membership is revoked.
5. **Shared-infrastructure leakage:**
   - job and outbox rows of A processed with B's context;
   - notification fan-out across orgs;
   - report aggregates or dashboard caches keyed without the org;
   - search results;
   - export file names and storage keys;
   - rate-limit keys.
6. **Resource exhaustion (noisy neighbour):** A floods bookings, search, exports or jobs. Per-org limits and job fairness must keep B within its budgets.
7. **Privilege games:** A's org admin tries to grant platform roles, read the global user list, enumerate other orgs' users by email (invite and login flows must not reveal membership elsewhere), or create a break-glass session.
8. **Billing abuse:** replayed or forged webhooks; downgrades that would orphan data; quota bypass through concurrent creates (DB-enforced counts).
9. **RLS bypass attempts:** SQL that omits the org filter (proved empty by RLS); connection reuse across tenants in the pool (`SET LOCAL` only, never session-level `SET`).
10. **Data lifecycle:** after offboarding, none of B's rows are reachable, and B's backups and exports are expired per contract.

## 4. Running-cost implications (from docs/release/COST_REPORT.md, us-east-1, prices checked 2026-10-22)
- **Shared model:** the production stack (≈ $199/month) serves several small tenants. The marginal cost per tenant is mainly storage, logs and requests (single-digit dollars per month at the current single-org scale), until the database or web tier must scale up. Add pooling (for example RDS Proxy) when connection counts require it; price it when sized.
- **Database-per-tenant tier:** ≈ $47/month (Multi-AZ db.t4g.small instance) + ≈ $4.60 storage + backups per tenant, before any compute changes.
- **Separate deployment per tenant:** ≈ $199/month per tenant (the full production stack).

## 5. What must stay true (regression guard for the future implementation)
- With all four flags OFF, every Phase 0–8 test still passes unchanged (unit, integration, e2e 45/45, drills), and migrations 0000–0014 stay applicable to a clean database.
- The readiness verdict logic is evaluated **per organization**. A new org starts NOT APPROVED regardless of other tenants.
- No organization identifier is ever accepted from a URL, query string or body as authority.

## 6. Recommendation
Do not start. Finish the organization-owned BLOCKED items in RC_CHECKLIST.md and run a single-organization pilot.

If commercial interest appears in the meantime, the only low-risk preparatory work is WP1 (RLS). It strengthens the single-organization deployment too, so it could be pulled forward with the owner's approval as a hardening task, not as SaaS work.
