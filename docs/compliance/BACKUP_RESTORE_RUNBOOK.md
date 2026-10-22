# Backup & restore drill runbook

`pnpm ops:restore-drill` (works with local PostgreSQL tools, or via `docker compose exec db` on Windows/Docker Desktop):
1. `pg_dump --format=custom` of `DATABASE_URL`.
2. If `BACKUP_ENCRYPTION_KEY` (≥ 32 chars) is set: AES-256-GCM encrypt to `backups/projectos-<time>.dump.enc`, then
   **decrypt it again** and restore from the decrypted bytes (proves the key works). Without a key the drill still runs but
   reports "encryption NOT CONFIGURED".
3. Restore into a scratch database `<db>_restore_drill`, compare row counts for 12 key tables, check the append-only
   audit trigger and migration history survived, measure the elapsed time (observed RTO), drop the scratch DB.
4. Record PASS/FAIL in `ops_drills` (append-only); shown on Administration → PHI Readiness.

## Last run (2026-10-22, synthetic demo database, this build)
PASS — dump 313 KB in 0.17 s, encrypted (AES-256-GCM) and decrypt-verified, restore 0.7 s, 0 mismatches across 12 tables,
audit trigger restored, 13 migrations restored, observed RTO ≈ 1 s.

## External tasks
- Copy the encrypted file off-host (e.g. object storage under a BAA) on a schedule matching the approved RPO.
- Keep `BACKUP_ENCRYPTION_KEY` in a key manager, separate from the backups; rotate on staff change.
- Run the drill weekly; a failed drill is an incident.
- Illustrative demo targets only: RPO ≤ 24 h, RTO ≤ 8 h. Real clinical targets must be approved by the organization.
