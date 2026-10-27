# "><(((º> sabusabu <º)))><"
# Sprint 1 / G1 — fondamenta: rete, chiavi KMS, PostgreSQL 16, bucket documenti, segreti.
# ECS Fargate, ALB/WAF e CloudFront arrivano con gli sprint successivi (vedi roadmap).

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

locals {
  prefix = "${var.name}-${var.environment}"
  azs    = slice(data.aws_availability_zones.available.names, 0, 3)
}

# ---------------------------------------------------------------------
# Rete: subnet pubbliche (ALB), private (ECS), database (RDS) su 3 AZ
# ---------------------------------------------------------------------
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.16"

  name = local.prefix
  cidr = var.vpc_cidr
  azs  = local.azs

  public_subnets   = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i)]
  private_subnets  = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i + 10)]
  database_subnets = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i + 20)]

  create_database_subnet_group = true
  enable_nat_gateway           = true
  single_nat_gateway           = var.environment != "prod"
  enable_dns_hostnames         = true

  enable_flow_log                      = true
  create_flow_log_cloudwatch_log_group = true
  create_flow_log_cloudwatch_iam_role  = true
}

# ---------------------------------------------------------------------
# KMS: dati a riposo (RDS, S3, Secrets) e segreti applicativi (TOTP)
# ---------------------------------------------------------------------
module "kms_data" {
  source  = "terraform-aws-modules/kms/aws"
  version = "~> 3.1"

  description             = "${local.prefix} cifratura dati a riposo (RDS, S3, Secrets Manager)"
  aliases                 = ["${local.prefix}-data"]
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

module "kms_app" {
  source  = "terraform-aws-modules/kms/aws"
  version = "~> 3.1"

  description             = "${local.prefix} envelope encryption segreti MFA (GenerateDataKey)"
  aliases                 = ["${local.prefix}-app"]
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

# ---------------------------------------------------------------------
# Security group: l'API (ECS) è l'unica sorgente ammessa verso il database
# ---------------------------------------------------------------------
resource "aws_security_group" "api" {
  name        = "${local.prefix}-api"
  description = "Task ECS API e worker"
  vpc_id      = module.vpc.vpc_id

  egress {
    description = "Uscita verso AWS API, RDS, Redis"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db" {
  name        = "${local.prefix}-db"
  description = "PostgreSQL raggiungibile solo dai task applicativi"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "PostgreSQL dai task API"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }
}

# ---------------------------------------------------------------------
# PostgreSQL 16 (RDS) — TLS obbligatorio, cifrato, password master in Secrets Manager
# ---------------------------------------------------------------------
module "db" {
  source  = "terraform-aws-modules/rds/aws"
  version = "~> 6.10"

  identifier           = local.prefix
  engine               = "postgres"
  engine_version       = "16"
  family               = "postgres16"
  major_engine_version = "16"
  instance_class       = var.db_instance_class

  allocated_storage     = 50
  max_allocated_storage = 500
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = module.kms_data.key_arn

  db_name                                = "cde"
  username                               = "cde_master"
  manage_master_user_password            = true
  master_user_secret_kms_key_id          = module.kms_data.key_arn
  iam_database_authentication_enabled    = true
  multi_az                               = var.db_multi_az
  db_subnet_group_name                   = module.vpc.database_subnet_group_name
  vpc_security_group_ids                 = [aws_security_group.db.id]
  backup_retention_period                = var.db_backup_retention_days
  deletion_protection                    = true
  skip_final_snapshot                    = false
  final_snapshot_identifier_prefix       = "${local.prefix}-final"
  copy_tags_to_snapshot                  = true
  performance_insights_enabled           = true
  performance_insights_kms_key_id        = module.kms_data.key_arn
  enabled_cloudwatch_logs_exports        = ["postgresql"]
  create_cloudwatch_log_group            = true
  cloudwatch_log_group_retention_in_days = 90
  auto_minor_version_upgrade             = true

  parameters = [
    { name = "rds.force_ssl", value = "1" },
    { name = "log_statement", value = "ddl" },
    { name = "log_min_duration_statement", value = "500" },
  ]
}

# ---------------------------------------------------------------------
# Bucket documenti: Versioning + Object Lock + SSE-KMS, nessun accesso pubblico
# ---------------------------------------------------------------------
resource "random_id" "bucket" {
  byte_length = 4
}

module "documents_bucket" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 4.2"

  bucket              = "${local.prefix}-documents-${random_id.bucket.hex}"
  object_lock_enabled = true

  versioning = {
    enabled = true
  }

  object_lock_configuration = {
    rule = {
      default_retention = {
        mode = var.object_lock_mode
        days = var.object_lock_days
      }
    }
  }

  server_side_encryption_configuration = {
    rule = {
      apply_server_side_encryption_by_default = {
        sse_algorithm     = "aws:kms"
        kms_master_key_id = module.kms_data.key_arn
      }
      bucket_key_enabled = true
    }
  }

  block_public_acls        = true
  block_public_policy      = true
  ignore_public_acls       = true
  restrict_public_buckets  = true
  control_object_ownership = true
  object_ownership         = "BucketOwnerEnforced"

  attach_deny_insecure_transport_policy = true
  attach_require_latest_tls_policy      = true

  cors_rule = [{
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = var.web_origins
    allowed_headers = ["Content-Type", "Content-MD5", "x-amz-checksum-sha256", "x-amz-sdk-checksum-algorithm"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }]

  lifecycle_rule = [{
    id                                     = "abort-incomplete-multipart"
    enabled                                = true
    abort_incomplete_multipart_upload_days = 7
  }]
}

# ---------------------------------------------------------------------
# Segreti applicativi (valori impostati fuori da Terraform, mai nello stato)
# ---------------------------------------------------------------------
resource "aws_secretsmanager_secret" "jwt_private_key" {
  name        = "${local.prefix}/jwt-private-key"
  description = "Chiave privata RS256 per la firma dei JWT di accesso (PEM)"
  kms_key_id  = module.kms_data.key_arn
}

resource "aws_secretsmanager_secret" "db_app_credentials" {
  for_each    = toset(["cde_owner", "cde_app", "cde_auth"])
  name        = "${local.prefix}/db/${each.key}"
  description = "Credenziali del ruolo PostgreSQL ${each.key}"
  kms_key_id  = module.kms_data.key_arn
}
