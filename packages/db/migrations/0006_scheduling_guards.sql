-- Phase 4: database-enforced no-double-booking.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
-- Two ACTIVE reservations for the same resource may never overlap. [start, end) so back-to-back is allowed.
-- The partial predicate deliberately uses only `state` (no now()): an expired hold keeps blocking until it is
-- explicitly released by the hold-expiry job or an in-transaction sweep. Capacity > 1 is NOT supported here.
ALTER TABLE resource_reservations ADD CONSTRAINT resource_reservations_no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    resource_type WITH =,
    resource_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (state = 'ACTIVE');
--> statement-breakpoint
-- Appointment history is append-only.
CREATE TRIGGER appointment_events_no_update BEFORE UPDATE OR DELETE ON appointment_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();
--> statement-breakpoint
-- A released reservation is never re-activated (release is one-way; book again instead).
CREATE OR REPLACE FUNCTION resource_reservations_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reservations are released, never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.state = 'RELEASED' AND NEW.state = 'ACTIVE' THEN
    RAISE EXCEPTION 'a released reservation cannot be re-activated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.start_at IS DISTINCT FROM OLD.start_at OR NEW.end_at IS DISTINCT FROM OLD.end_at
     OR NEW.resource_id IS DISTINCT FROM OLD.resource_id OR NEW.resource_type IS DISTINCT FROM OLD.resource_type THEN
    RAISE EXCEPTION 'reservations are immutable; release and create a new one' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER resource_reservations_guard_trg BEFORE UPDATE OR DELETE ON resource_reservations
  FOR EACH ROW EXECUTE FUNCTION resource_reservations_guard();
--> statement-breakpoint
-- New permission for existing organizations (fresh orgs get it from the role catalog at bootstrap).
INSERT INTO role_permissions (organization_id, role_id, permission)
  SELECT r.organization_id, r.id, 'scheduling.configure' FROM roles r WHERE r.key IN ('org_admin', 'scheduling_manager')
  ON CONFLICT DO NOTHING;
