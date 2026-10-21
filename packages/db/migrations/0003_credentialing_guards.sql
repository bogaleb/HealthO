-- Verification history is append-only.
CREATE TRIGGER authority_verifications_no_update BEFORE UPDATE OR DELETE ON authority_verifications
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();
--> statement-breakpoint
-- Approved/retired policy rules are immutable except for retirement (supersede, never edit in place).
CREATE OR REPLACE FUNCTION license_rules_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'approved or retired policy rules cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'RETIRED' THEN
    RAISE EXCEPTION 'retired policy rules are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'APPROVED' AND (
      NEW.status <> 'RETIRED' OR NEW.jurisdiction IS DISTINCT FROM OLD.jurisdiction OR NEW.profession IS DISTINCT FROM OLD.profession
      OR NEW.modality IS DISTINCT FROM OLD.modality OR NEW.authorization_basis IS DISTINCT FROM OLD.authorization_basis
      OR NEW.accepted_home_states IS DISTINCT FROM OLD.accepted_home_states OR NEW.provider_states IS DISTINCT FROM OLD.provider_states
      OR NEW.effective_from IS DISTINCT FROM OLD.effective_from OR NEW.service_category IS DISTINCT FROM OLD.service_category) THEN
    RAISE EXCEPTION 'approved policy rules are immutable; create a new version instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER license_rules_guard_trg BEFORE UPDATE OR DELETE ON license_policy_rules
  FOR EACH ROW EXECUTE FUNCTION license_rules_guard();
