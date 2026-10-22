/**
 * PHI / live-patient readiness evidence catalog (blueprint §9.2 + specs/GO_LIVE_CHECKLIST.md). Each item is satisfied
 * only by EXTERNAL evidence (signed documents, contracts, drills) reviewed by a different person than the submitter.
 * This list is a tracking aid, not proof of compliance, and it never makes the product "HIPAA compliant".
 */
export interface CatalogItem {
  key: string;
  category: string;
  title: string;
  requirement: string;
  ownerRole: string;
  critical: boolean;
  external: boolean;
}

export const COMPLIANCE_CATALOG: CatalogItem[] = [
  {
    key: "governance.officers",
    category: "Governance",
    title: "Privacy and security officers named",
    requirement: "Organization-level privacy officer and security officer assigned in writing, with documented responsibilities.",
    ownerRole: "Executive sponsor",
    critical: true,
    external: true,
  },
  {
    key: "data.flow_inventory",
    category: "Data inventory",
    title: "Data-flow diagram and data inventory",
    requirement:
      "Written data flows and inventory covering the app, database, backups, logs, email, monitoring, helpdesk, analytics, AI and every sub-processor (start from docs/compliance/DATA_FLOW.md).",
    ownerRole: "Privacy officer",
    critical: true,
    external: true,
  },
  {
    key: "risk.analysis",
    category: "Risk analysis",
    title: "Security risk analysis + remediation plan accepted",
    requirement: "Documented HIPAA security risk analysis for the actual deployment, with an accepted remediation plan (start from docs/compliance/SECURITY_RISK_REGISTER.md).",
    ownerRole: "Security officer",
    critical: true,
    external: true,
  },
  {
    key: "baa.executed",
    category: "BAAs",
    title: "Business associate agreements executed",
    requirement: "BAAs with the healthcare organization and every PHI-handling subcontractor (hosting, backups, email/SMS, monitoring, support tools).",
    ownerRole: "Legal / compliance",
    critical: true,
    external: true,
  },
  {
    key: "hosting.eligible",
    category: "Hosting",
    title: "Eligible, correctly configured hosting",
    requirement: "Selected cloud services verified as eligible under the provider's BAA and configured: encryption at rest/in transit, network, access, backups, audit logging.",
    ownerRole: "Cloud / security lead",
    critical: true,
    external: true,
  },
  {
    key: "identity.mfa_lifecycle",
    category: "Identity",
    title: "MFA, least privilege and joiner/mover/leaver",
    requirement: "MFA enforced for privileged users (REQUIRE_MFA_FOR_PRIVILEGED), no shared accounts, emergency access, session timeout, documented joiner/mover/leaver procedure.",
    ownerRole: "IT lead",
    critical: true,
    external: false,
  },
  {
    key: "access.policy_tested",
    category: "Access",
    title: "Access restrictions tested for the pilot",
    requirement: "Organization/site/department/patient restrictions verified against the pilot's roles; admin and audit roles scoped; dashboards minimum necessary.",
    ownerRole: "Security engineer",
    critical: true,
    external: false,
  },
  {
    key: "appsec.testing",
    category: "App security",
    title: "Independent security testing",
    requirement: "Penetration / access-control / injection tests by a qualified tester; SAST, dependency and secret scans in CI with findings triaged.",
    ownerRole: "Security engineer",
    critical: true,
    external: true,
  },
  {
    key: "data.protection",
    category: "Data protection",
    title: "Encryption, no PHI in URLs/logs/telemetry",
    requirement: "TLS everywhere, encryption at rest with key management, no PHI in URLs/logs/third-party telemetry, private storage, encrypted backup copies.",
    ownerRole: "Security officer",
    critical: true,
    external: true,
  },
  {
    key: "audit.coverage",
    category: "Audit",
    title: "Audit coverage and review process",
    requirement:
      "Patient record reads, exports, booking changes, role changes, policy approvals and integration access are audited; a periodic review process and retention are set.",
    ownerRole: "Compliance",
    critical: true,
    external: false,
  },
  {
    key: "recovery.drills",
    category: "Recovery",
    title: "Backup encryption, restore drill, RPO/RTO approved",
    requirement: "Encrypted off-host backups, a restore drill run and recorded (pnpm ops:restore-drill), RPO/RTO approved, DR and incident-response runbooks exercised.",
    ownerRole: "IT / operations",
    critical: true,
    external: true,
  },
  {
    key: "data.rights_retention",
    category: "Data governance",
    title: "Access, amendment, retention and deletion rules",
    requirement: "Data-subject access/amendment/retention/deletion rules mapped to the organization's obligations and the BAAs.",
    ownerRole: "Privacy officer",
    critical: true,
    external: true,
  },
  {
    key: "ehr.source_of_truth",
    category: "Appointment source",
    title: "EHR source of truth + verified vendor capabilities",
    requirement:
      "Per-site source-of-truth decision signed by scheduling operations; vendor API agreement in place; each adapter capability verified against vendor documentation and test access; reconciliation plan.",
    ownerRole: "Scheduling / EHR lead",
    critical: true,
    external: true,
  },
  {
    key: "license.policy_verified",
    category: "License policy",
    title: "Licensure rule catalog verified",
    requirement: "State/profession/modality rules for the pilot reviewed by qualified staff or counsel, with effective dates and escalation contacts. DEMO rules removed.",
    ownerRole: "Credentialing / legal",
    critical: true,
    external: true,
  },
  {
    key: "payer.rules_approved",
    category: "Payer/site rules",
    title: "Payer participation data approved",
    requirement: "Plan × provider × site participation data for the pilot verified by contracting/credentialing.",
    ownerRole: "Contracting / credentialing",
    critical: true,
    external: true,
  },
  {
    key: "messaging.approved",
    category: "Messaging",
    title: "Patient messaging decisions",
    requirement: "If any reminders are enabled: approved templates (no clinical details), opt-in/out rules, vetted vendors with BAAs. Phase 7 sends none.",
    ownerRole: "Privacy / operations",
    critical: false,
    external: true,
  },
  {
    key: "staff.training",
    category: "Staff readiness",
    title: "Training, escalation and downtime procedures",
    requirement: "Staff trained on the workflow, the patient-location-at-visit protocol, escalation paths and the downtime plan (docs/compliance/DOWNTIME_PLAN.md).",
    ownerRole: "Scheduling lead",
    critical: true,
    external: true,
  },
  {
    key: "incident.response",
    category: "Incident response",
    title: "Incident response plan exercised",
    requirement: "Incident response and breach-notification procedure documented and tabletop-tested (docs/compliance/INCIDENT_RESPONSE.md).",
    ownerRole: "Security officer",
    critical: true,
    external: true,
  },
  {
    key: "golive.signoff",
    category: "Go-live",
    title: "Controlled rollout and risk acceptance signed",
    requirement: "Limited pilot scope, rollback/backout decision owner, manual backup schedule, and the sponsor's signed risk acceptance.",
    ownerRole: "Executive sponsor",
    critical: true,
    external: true,
  },
];
