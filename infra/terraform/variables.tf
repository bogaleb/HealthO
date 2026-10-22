variable "environment" {
  description = "staging or production."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "region" {
  description = "AWS region (one region; the app is a single-organization modular monolith)."
  type        = string
  default     = "us-east-1"
}

variable "phi_approved" {
  description = "Set true ONLY after the BAA, the service-scope check and the organization's go-live signoff are recorded. Gates production-only safeguards and is shown as a DataClass tag."
  type        = bool
  default     = false
}

variable "baa_reference" {
  description = "Reference to the executed AWS BAA (AWS Artifact agreement id / internal document id). Required when phi_approved = true."
  type        = string
  default     = ""
}

variable "service_scope_verified_on" {
  description = "Date (YYYY-MM-DD) the HIPAA Eligible Services list was checked for every service in this stack. Required when phi_approved = true."
  type        = string
  default     = ""
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "domain_name" {
  description = "Public hostname served by the ALB (e.g. ops.example.org)."
  type        = string
}

variable "acm_certificate_arn" {
  description = "ARN of an issued ACM certificate for domain_name (DNS validation is done in the organization's DNS)."
  type        = string
}

variable "allowed_ingress_cidrs" {
  description = "CIDRs allowed to reach HTTPS (clinic/office egress IPs or VPN). Avoid 0.0.0.0/0 for an internal operations app."
  type        = list(string)
}

variable "image_tag" {
  description = "Immutable release tag (the git SHA) for the web, worker and migrate images in ECR."
  type        = string
}

variable "web_desired_count" {
  type    = number
  default = 2
}

variable "web_cpu" {
  type    = number
  default = 512
}

variable "web_memory" {
  type    = number
  default = 1024
}

variable "worker_cpu" {
  type    = number
  default = 256
}

variable "worker_memory" {
  type    = number
  default = 512
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "db_multi_az" {
  type    = bool
  default = true
}

variable "db_backup_retention_days" {
  type    = number
  default = 35
}

variable "log_retention_days" {
  description = "CloudWatch retention for application logs (logs contain no PHI by design; audit evidence lives in the database)."
  type        = number
  default     = 365
}

variable "alert_email" {
  description = "Optional on-call email for alarms (SNS). Leave empty to wire alerts elsewhere."
  type        = string
  default     = ""
}

variable "enable_waf" {
  type    = bool
  default = true
}

variable "app_mode" {
  description = "APP_MODE for the containers. PILOT_APPROVED/PRODUCTION_APPROVED only after the go-live signoff."
  type        = string
  default     = "DEMO_SYNTHETIC"
}
