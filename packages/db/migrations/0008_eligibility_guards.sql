-- Phase 5: eligibility evaluations are an immutable decision log.
CREATE TRIGGER eligibility_evaluations_no_update BEFORE UPDATE OR DELETE ON eligibility_evaluations
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();
--> statement-breakpoint
-- Phase 4 demo bookings were never evaluated: keep them visibly "policy pending" (eligibility_decision stays NULL)
-- until a re-check or the rescreen job evaluates them. Nothing is silently marked eligible.
UPDATE appointments SET eligibility_status = 'POLICY_PENDING' WHERE eligibility_decision IS NULL;
