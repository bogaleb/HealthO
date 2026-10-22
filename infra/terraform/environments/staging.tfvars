# Staging: SYNTHETIC data only. Smaller, single-AZ database; one web task.
environment              = "staging"
region                   = "us-east-1"
domain_name              = "staging.ops.example.org"
acm_certificate_arn      = "arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
allowed_ingress_cidrs    = ["203.0.113.0/24"]
image_tag                = "replace-with-git-sha"
web_desired_count        = 1
db_instance_class        = "db.t4g.micro"
db_multi_az              = false
db_backup_retention_days = 7
log_retention_days       = 90
app_mode                 = "DEMO_SYNTHETIC"
phi_approved             = false
