# ProjectOS Health — AWS reference infrastructure (Phase 8).
#
#   ██  DO NOT APPLY to an account that will hold real PHI until ALL of these are externally verified and signed:
#   ██   1. An executed AWS Business Associate Addendum covering the account (AWS Artifact).
#   ██   2. Every service used below is on AWS's *current* HIPAA Eligible Services list, checked on the day of the
#   ██      decision (docs/ops/AWS_SERVICE_SCOPE.md records the check). A BAA does NOT make any configuration compliant.
#   ██   3. The organization's own risk analysis, policies and the readiness checklist in the app are approved.
#
# Until then this code may be applied only to a sandbox/staging account holding SYNTHETIC data.
# Validated with `tofu validate` (OpenTofu 1.10) + checkov; never applied by the authors of this repo.
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66"
    }
  }
  # Remote state: S3 with native locking; the bucket is created by the account bootstrap, not here.
  # terraform init -backend-config=environments/<env>.backend.hcl
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Application = "projectos-health"
      Environment = var.environment
      DataClass   = var.phi_approved ? "PHI" : "SYNTHETIC"
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_availability_zones" "available" { state = "available" }
