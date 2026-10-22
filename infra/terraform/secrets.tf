# Application secrets. Terraform creates the containers only; VALUES are set out-of-band by an operator
# (aws secretsmanager put-secret-value) so they never enter Terraform state, CI logs or this repository.
resource "aws_secretsmanager_secret" "app" {
  #checkov:skip=CKV2_AWS_57:Rotated by runbook, not Lambda: rotating the auth secret signs everyone out and the backup key requires re-encrypting stored backups (docs/ops/OPERATIONS_HANDBOOK.md › Secret rotation). The DB master password is rotated by RDS.
  for_each                = toset(["better-auth-secret", "backup-encryption-key", "db-app-password"])
  name                    = "${local.name}/${each.key}"
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = 30
}
