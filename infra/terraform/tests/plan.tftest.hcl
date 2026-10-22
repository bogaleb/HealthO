# `tofu test` / `terraform test` with a mocked AWS provider: no credentials, nothing created. Proves the stack
# plans for both environments and that the PHI gate refuses an unverified configuration.
mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-1a", "us-east-1b"] }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111111111111" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_resource "aws_db_instance" {
    defaults = {
      arn                = "arn:aws:rds:us-east-1:111111111111:db:projectos"
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:us-east-1:111111111111:secret:rds-master", kms_key_id = "k", secret_status = "active" }]
    }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:us-east-1:111111111111:key/00000000-0000-0000-0000-000000000000" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:us-east-1:111111111111:log-group:x" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111111111111:role/x" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:us-east-1:111111111111:x" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:us-east-1:111111111111:secret:x" }
  }
  mock_resource "aws_ecr_repository" {
    defaults = { arn = "arn:aws:ecr:us-east-1:111111111111:repository/x", repository_url = "111111111111.dkr.ecr.us-east-1.amazonaws.com/x" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::x", bucket = "x", id = "x" }
  }
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:111111111111:loadbalancer/app/x/1", arn_suffix = "app/x/1" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:111111111111:targetgroup/x/1", arn_suffix = "targetgroup/x/1" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:us-east-1:111111111111:cluster/x" }
  }
  mock_resource "aws_ecs_service" {
    defaults = { id = "arn:aws:ecs:us-east-1:111111111111:service/x/web" }
  }
  mock_resource "aws_wafv2_web_acl" {
    defaults = { arn = "arn:aws:wafv2:us-east-1:111111111111:regional/webacl/x/1" }
  }
}

run "staging_plans" {
  command = plan
  variables {
    environment           = "staging"
    domain_name           = "staging.ops.example.org"
    acm_certificate_arn   = "arn:aws:acm:us-east-1:111111111111:certificate/x"
    allowed_ingress_cidrs = ["203.0.113.0/24"]
    image_tag             = "abc1234"
    db_multi_az           = false
  }
  assert {
    condition     = aws_db_instance.main.storage_encrypted && !aws_db_instance.main.publicly_accessible && aws_db_instance.main.deletion_protection
    error_message = "database must be encrypted, private and deletion-protected"
  }
  assert {
    condition     = aws_lb_listener.https.ssl_policy == "ELBSecurityPolicy-TLS13-1-2-2021-06"
    error_message = "TLS 1.2+ policy required"
  }
  assert {
    condition     = alltrue([for r in aws_ecr_repository.app : r.image_tag_mutability == "IMMUTABLE"])
    error_message = "release images must be immutable"
  }
  assert {
    condition     = !aws_ecs_service.web.enable_execute_command && !aws_ecs_service.worker.enable_execute_command
    error_message = "no interactive shells into PHI-capable containers"
  }
}

run "production_plans_without_phi" {
  command = plan
  variables {
    environment           = "production"
    domain_name           = "ops.example.org"
    acm_certificate_arn   = "arn:aws:acm:us-east-1:111111111111:certificate/x"
    allowed_ingress_cidrs = ["203.0.113.0/24"]
    image_tag             = "abc1234"
  }
  assert {
    condition     = aws_db_instance.main.multi_az && aws_db_instance.main.backup_retention_period == 35
    error_message = "production database must be Multi-AZ with 35-day backups"
  }
}

run "phi_gate_refuses_unverified_configuration" {
  command = plan
  variables {
    environment           = "production"
    domain_name           = "ops.example.org"
    acm_certificate_arn   = "arn:aws:acm:us-east-1:111111111111:certificate/x"
    allowed_ingress_cidrs = ["203.0.113.0/24"]
    image_tag             = "abc1234"
    phi_approved          = true
  }
  expect_failures = [terraform_data.phi_gate]
}

run "approved_app_mode_requires_phi_gate" {
  command = plan
  variables {
    environment           = "production"
    domain_name           = "ops.example.org"
    acm_certificate_arn   = "arn:aws:acm:us-east-1:111111111111:certificate/x"
    allowed_ingress_cidrs = ["203.0.113.0/24"]
    image_tag             = "abc1234"
    app_mode              = "PRODUCTION_APPROVED"
  }
  expect_failures = [terraform_data.phi_gate]
}
