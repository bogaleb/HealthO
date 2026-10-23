# ADR-0014 — Commercial multi-organization SaaS: deferred, with a gated plan

_Status: **Proposed — not started** · Date: 2026-10-23 · Supersedes nothing; extends ADR-0002_

## Context
Prompt 09 asks for:

- new-organization provisioning, tenant admin, organization switching and strict isolation;
- subscription billing and quotas;
- per-customer data lifecycle;
- per-customer BAAs;
- break-glass support;
- scalability work;
- malicious-tenant testing.

It also says explicitly: **do not start before a pilot, only with explicit project-owner approval, and produce an estimate and this ADR first.** The product today is a release candidate for a *synthetic* staging deployment (RC v0.3.0-rc.1). There is no pilot, and the readiness verdict is NOT APPROVED FOR REAL PHI.

## Decision
1. **No commercial code is written in this phase.** Phase 9 delivers this ADR plus the estimate and isolation assessment in `docs/release/SAAS_EXPANSION_ESTIMATE.md`.
2. **Entry gate.** Implementation starts only when all of the following are true:
   - (a) a single-organization pilot with real users has run for at least 60 days with the RC checklist cleared;
   - (b) the project owner approves in writing (scope, budget and target customers);
   - (c) counsel confirms the business-associate model, meaning ProjectOS becomes a BA of each covered-entity customer;
   - (d) a named security owner exists for the multi-tenant risk analysis.
3. **Tenancy model (when started): shared database, shared schema, `organization_id` everywhere, plus PostgreSQL row-level security as a second wall.** This builds on what already exists:
   - 60 tables carry `organization_id`, and 57 of them have it `NOT NULL`;
   - all 80 foreign keys between domain tables are composite `(organization_id, id)`;
   - 0 domain foreign keys are single-column;
   - the organization always comes from the session.
   
   A **database-per-tenant** tier stays available for customers whose contracts demand physical separation. Its cost is roughly one production database per tenant (COST_REPORT: about $47/month Multi-AZ db.t4g.small plus storage and backups), and it would be priced accordingly.
4. **Feature flags.** `COMMERCIAL_REGISTRATION`, `ORG_SWITCHING`, `BILLING` and `SUPPORT_BREAK_GLASS` all default **OFF**. With all of them off, behaviour must stay byte-for-byte the current single-organization behaviour, and every existing migration stays valid.
5. **Ordering.** Isolation hardening (RLS plus a cross-tenant attack suite) ships **before** any second real organization exists. Billing ships last.
6. **No PHI to new vendors.** Billing and support vendors receive organization and contact data only, never patient data. Any vendor that could see PHI needs a BAA and a scope check first.

## Alternatives considered

| Option | Isolation | Cost / ops | Verdict |
|---|---|---|---|
| Shared schema + `organization_id` + RLS | Logical; two walls (app and DB) | Lowest; one stack | **Chosen default** |
| Schema per tenant | Stronger | Migrations ×N, pooling complexity | Rejected: complexity without contractual benefit |
| Database per tenant | Physical | About $50+/tenant/month, migrations ×N | Offered as a premium tier only |
| Separate deployment per tenant | Strongest | Full stack per tenant (about $199/month, COST_REPORT) | For enterprise or contract-required cases only |

## Consequences
- Until the gate is passed, `loadAuthContext` keeps refusing users with more than one active membership. That is a deliberate safety property, not a bug.
- About 21–29 engineer-weeks of work plus external pen-test and legal costs (SAAS_EXPANSION_ESTIMATE.md).
- ADR-0002's deferred item, RLS as defense-in-depth, is now done for single-organization deployments (ADR-0015, migration 0015). The per-transaction tenant context needed for a *shared* runtime is still a prerequisite for a second organization.
