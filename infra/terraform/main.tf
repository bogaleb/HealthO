locals {
  name = "projectos-${var.environment}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 2)
  prod = var.environment == "production"
}

# Hard gate: refuse to plan a PHI configuration without the external evidence references.
resource "terraform_data" "phi_gate" {
  input = { phi_approved = var.phi_approved, baa = var.baa_reference, scope = var.service_scope_verified_on }
  lifecycle {
    precondition {
      condition     = !var.phi_approved || (length(var.baa_reference) > 0 && can(regex("^\\d{4}-\\d{2}-\\d{2}$", var.service_scope_verified_on)))
      error_message = "phi_approved = true requires baa_reference and service_scope_verified_on (externally verified). A BAA alone does not make this configuration compliant."
    }
    precondition {
      condition     = var.phi_approved || !contains(["PILOT_APPROVED", "PRODUCTION_APPROVED"], var.app_mode)
      error_message = "APP_MODE PILOT_APPROVED/PRODUCTION_APPROVED requires phi_approved = true."
    }
  }
}
