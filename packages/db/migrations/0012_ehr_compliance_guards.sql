-- Phase 7: drill results and integration run logs are evidence; make them append-only.
CREATE TRIGGER ops_drills_no_update BEFORE UPDATE OR DELETE ON ops_drills
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();
--> statement-breakpoint
CREATE TRIGGER integration_sync_runs_no_delete BEFORE DELETE ON integration_sync_runs
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();
--> statement-breakpoint
-- Pending appointments already saved at EHR-master sites (Phase 5 drafts) are drafts that were never sent to the EHR.
UPDATE appointments a SET ehr_state = 'DRAFT'
  FROM sites s WHERE s.id = a.site_id AND s.ehr_sync_mode = 'EHR_MASTER' AND a.status = 'PENDING';
--> statement-breakpoint
-- New permissions for existing organizations (fresh orgs get them from the role catalog at bootstrap).
INSERT INTO role_permissions (organization_id, role_id, permission)
  SELECT r.organization_id, r.id, 'integrations.manage' FROM roles r WHERE r.key = 'org_admin'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (organization_id, role_id, permission)
  SELECT r.organization_id, r.id, 'compliance.manage' FROM roles r WHERE r.key IN ('org_admin', 'compliance_officer')
  ON CONFLICT DO NOTHING;
