# Incident response outline (to be adopted by the security officer)

1. **Detect** — sources: Worker & Outbox page (dead letters), Integration Health (stale/unreachable EHR, conflicts),
   audit log DENY spikes, failed restore drill, user reports.
2. **Triage (≤ 1 h)** — severity; is real PHI involved? (Today: no — synthetic only.) Name an incident lead.
3. **Contain** — suspend affected memberships (Staff & Permissions), rotate `BETTER_AUTH_SECRET` (invalidates
   sessions), disable an EHR connection (set site to READ_ONLY), switch front desk to the downtime plan.
4. **Investigate** — audit log by request id / actor / time; outbox and sync-run history; database restore to a scratch DB
   for comparison (`pnpm ops:restore-drill` pattern).
5. **Recover** — restore from encrypted backup if needed; reconcile with the EHR; verify with the clinic-day checklist.
6. **Notify** — breach-notification decision by privacy officer/legal per HIPAA and state law and the BAAs (external).
7. **Learn** — post-incident review, update SECURITY_RISK_REGISTER.md.

Tabletop exercise and adoption are **external** checklist items (`incident.response`).
