-- Audit events are append-only: block UPDATE and DELETE at the database level.
CREATE OR REPLACE FUNCTION audit_events_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_block_mutation();
--> statement-breakpoint
-- Emails are stored normalized (lower-case) so the unique index is case-insensitive in practice.
ALTER TABLE users ADD CONSTRAINT users_email_lowercase_ck CHECK (email = lower(email));
--> statement-breakpoint
-- A task's parent must be a top-level task in the same project (max two levels) — enforced in service; depth check is in schema.
COMMENT ON TABLE audit_events IS 'Append-only. Metadata holds IDs/field names only, never PHI.';
