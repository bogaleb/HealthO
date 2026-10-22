output "alb_dns_name" {
  description = "Point the organization's DNS record for domain_name here (CNAME/alias)."
  value       = aws_lb.main.dns_name
}

output "ecr_repositories" {
  value = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "migrate_task_definition" {
  value = aws_ecs_task_definition.migrate.arn
}

output "app_subnets" {
  value = aws_subnet.app[*].id
}

output "worker_security_group" {
  value = aws_security_group.worker.id
}

output "db_endpoint" {
  value = aws_db_instance.main.address
}

output "db_master_secret_arn" {
  description = "RDS-managed master credential (migrations + app-role bootstrap only)."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "secrets_to_populate" {
  description = "Set these values out-of-band (never via Terraform)."
  value       = { for k, s in aws_secretsmanager_secret.app : k => s.arn }
}

output "backup_bucket" {
  value = aws_s3_bucket.backups.bucket
}
