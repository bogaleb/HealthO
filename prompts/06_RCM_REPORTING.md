# Prompt 06 — Revenue cycle, work queues and accurate executive dashboards

Read current progress. Implement Phase 6 using only synthetic RCM case data or expressly de-identified operational metadata. This is not a claims clearinghouse.

Create queues and cases with payer/type/status/priority/owner/next action/age category, follow-up events, task links and bulk assignment with transactional permissions. Support separate denial initiative, aging follow-up, credentialing-linked payer issue and billing quality work queues. Add pages `/rcm/queues`, `/rcm/cases/[id]`, queue assignment and escalation UIs, `/reports`, and Operations Dashboard. SQL-derived metrics only; counts reconcile to source rows, with filter/date/source/freshness metadata. Use Postgres outbox worker for due-soon and overdue internal notifications, idempotent job keys. No SMS/email at this phase.

Test RCM assignment/authorization, audit, aggregate reconciliation, no duplication on retry, workflow link to projects, scheduling + credentialing rollup, worker failure and replay. Accessibility test keyboard board/calendar/wizard. Update docs and show real browser screenshots with synthetic data, plus commands actually run.
