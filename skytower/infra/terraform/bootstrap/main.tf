# "><(((º> sabusabu <º)))><"
# Bootstrap dell'account (una tantum, runbook §1): stato Terraform remoto con lock e accesso di GitHub Actions
# via OIDC per il workflow di deploy. Lo stato di questo stack resta locale (custodito da chi amministra
# l'account) oppure, dopo il primo apply, si migra nel bucket creato qui.

terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "cde-iso19650", Environment = "bootstrap", ManagedBy = "terraform" }
  }
}

variable "region" {
  type    = string
  default = "eu-south-1"
}

variable "state_bucket" {
  description = "Nome (globale) del bucket per lo stato di envs/staging ed envs/prod"
  type        = string
  default     = "cde-terraform-state"
}

variable "lock_table" {
  type    = string
  default = "cde-terraform-lock"
}

variable "github_repository" {
  description = "owner/repo autorizzato a fare deploy"
  type        = string
  default     = "Alessio-Mangiagi/Programmi-pronti-"
}

variable "environments" {
  description = "Environment GitHub ammessi: il ruolo di ciascuno si assume solo dai job di quell'environment"
  type        = list(string)
  default     = ["staging", "prod"]
}

variable "deploy_policy_arn" {
  description = <<-EOT
    Permessi del ruolo di deploy. Terraform crea rete, IAM, KMS, RDS ed ECS: serve un perimetro ampio.
    Il rischio si contiene sul trust (solo questo repository e l'environment, con approvazione per prod);
    restringere con una policy dedicata quando lo stack è stabile.
  EOT
  type        = string
  default     = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# ---------------------------------------------------------------------
# Stato remoto
# ---------------------------------------------------------------------
resource "aws_s3_bucket" "state" {
  bucket = var.state_bucket
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "state_tls" {
  statement {
    sid       = "SoloTLS"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state_tls.json
}

resource "aws_dynamodb_table" "lock" {
  name         = var.lock_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }
}

# ---------------------------------------------------------------------
# GitHub Actions via OIDC: nessuna chiave AWS nel repository
# ---------------------------------------------------------------------
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "deploy_trust" {
  for_each = toset(var.environments)
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:skytower-${each.key}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  for_each             = toset(var.environments)
  name                 = "cde-${each.key}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.deploy_trust[each.key].json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "deploy" {
  for_each   = toset(var.environments)
  role       = aws_iam_role.deploy[each.key].name
  policy_arn = var.deploy_policy_arn
}

output "deploy_role_arns" {
  description = "Da impostare come vars.AWS_DEPLOY_ROLE_ARN negli environment GitHub skytower-<ambiente>"
  value       = { for k, r in aws_iam_role.deploy : k => r.arn }
}

output "state_bucket" {
  value = aws_s3_bucket.state.id
}

output "lock_table" {
  value = aws_dynamodb_table.lock.name
}
