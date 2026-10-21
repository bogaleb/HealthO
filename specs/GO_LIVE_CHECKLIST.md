# PHI / Live Patient Scheduling Release Gate

**Default decision: NO-GO.** This checklist is not proof of compliance. The owner-designated compliance/privacy/security and clinical operations leaders must review and sign externally with evidence.

| Gate | Evidence required | Owner | Status |
|---|---|---|---|
| Governance | privacy/security officers, documented roles | Executive sponsor | NOT STARTED |
| Risk analysis | documented HIPAA security risk analysis and action plan | Security officer | NOT STARTED |
| BAAs | executed agreements with provider organization and PHI-handling subprocessors | Legal/compliance | NOT STARTED |
| Hosting | eligible services verified, AWS/account BAA, secure deployment review | Cloud/security lead | NOT STARTED |
| Data inventory | patient data, logs, backups, email, monitoring, AI and integration flows mapped | Privacy officer | NOT STARTED |
| Identity | MFA, joiner/leaver, least privilege, session policies | IT lead | NOT STARTED |
| App security | penetration/access/injection/file-upload security tests | Security engineer | NOT STARTED |
| Audit | read/write/export/policy change coverage and review process | Compliance | NOT STARTED |
| Recovery | backup encryption and restore drill, downtime schedule workflow | IT/operations | NOT STARTED |
| Appointment source | authoritative EHR/site decisions, integration access, reconciliation | Scheduling/EHR lead | NOT STARTED |
| License policy | profession/state/modality rules and exceptions verified and reviewed | Credentialing/legal | NOT STARTED |
| Payer/site rules | plan-specific participation data approved | Contracting/credentialing | NOT STARTED |
| Messaging | approved content, opt-out rules, vetted vendors/BAAs | Privacy/operations | NOT STARTED |
| Staff readiness | training, escalation, patient travel location protocol | Scheduling lead | NOT STARTED |
| Go-live rollback | controlled rollout, owner signatures, backout decision | Executive sponsor | NOT STARTED |

Any `NOT STARTED` or `BLOCKED` critical item prevents PHI deployment. Keep app in synthetic mode until documentation and approvals exist. Periodically revalidate requirements and current law.
