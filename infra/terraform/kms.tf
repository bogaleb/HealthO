# One customer-managed key per data class, with automatic rotation. Key policies grant the account root (so IAM
# policies decide) plus the AWS services that must use the key.
# Key policies: "Resource": "*" means "this key" — that is how KMS key policies are written.
data "aws_iam_policy_document" "kms_data" {
  #checkov:skip=CKV_AWS_109:Key policy; the account root statement delegates to IAM policies.
  #checkov:skip=CKV_AWS_111:Key policy; the account root statement delegates to IAM policies.
  #checkov:skip=CKV_AWS_356:Key policy resource "*" refers to this key only.
  statement {
    sid       = "AccountAdmin"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
}

data "aws_iam_policy_document" "kms_logs" {
  #checkov:skip=CKV_AWS_109:Key policy; the account root statement delegates to IAM policies.
  #checkov:skip=CKV_AWS_111:Key policy; the account root statement delegates to IAM policies.
  #checkov:skip=CKV_AWS_356:Key policy resource "*" refers to this key only.
  statement {
    sid       = "AccountAdmin"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
  statement {
    sid       = "CloudWatchLogs"
    actions   = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["logs.${var.region}.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:*"]
    }
  }
  statement {
    sid       = "SNSAndCloudWatchAlarms"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com", "sns.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "data" {
  description             = "${local.name} database, backups, secrets, container images"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms_data.json
}

resource "aws_kms_alias" "data" {
  name          = "alias/${local.name}-data"
  target_key_id = aws_kms_key.data.key_id
}

resource "aws_kms_key" "logs" {
  description             = "${local.name} CloudWatch logs and alerts"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms_logs.json
}

resource "aws_kms_alias" "logs" {
  name          = "alias/${local.name}-logs"
  target_key_id = aws_kms_key.logs.key_id
}
