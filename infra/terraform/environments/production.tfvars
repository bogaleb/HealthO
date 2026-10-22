# Production: DO NOT APPLY with phi_approved = true until the BAA reference, the service-scope check date and the
# organization's go-live signoff exist (see infra/terraform/README.md). Until then production holds no PHI.
environment               = "production"
region                    = "us-east-1"
domain_name               = "ops.example.org"
acm_certificate_arn       = "arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
allowed_ingress_cidrs     = ["203.0.113.0/24"]
image_tag                 = "replace-with-git-sha"
web_desired_count         = 2
db_instance_class         = "db.t4g.small"
db_multi_az               = true
db_backup_retention_days  = 35
log_retention_days        = 365
app_mode                  = "DEMO_SYNTHETIC"
phi_approved              = false
baa_reference             = ""
service_scope_verified_on = ""
