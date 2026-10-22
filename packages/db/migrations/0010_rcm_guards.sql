-- Phase 6: the RCM action timeline is append-only (same guard as audit_events).
CREATE TRIGGER rcm_case_actions_no_update BEFORE UPDATE OR DELETE ON rcm_case_actions
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();
--> statement-breakpoint
-- New permission for existing organizations (fresh orgs get it from the role catalog at bootstrap).
INSERT INTO role_permissions (organization_id, role_id, permission)
  SELECT r.organization_id, r.id, 'rcm.manage' FROM roles r WHERE r.key IN ('org_admin', 'rcm_supervisor')
  ON CONFLICT DO NOTHING;
