# "><(((º> sabusabu <º)))><"
# G58 — produzione: rete su 3 AZ, PostgreSQL 16 Multi-AZ (PITR 35 gg, backup replicati in DR),
# documenti su S3 Object Lock COMPLIANCE con replica in DR, Redis per il rate limit, segreti.
# Calcolo (ECS) in ecs.tf, ingresso (CloudFront, WAF, ALB) in edge.tf, allarmi in monitoring.tf,
# AWS Backup in backup.tf.

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

locals {
  prefix = "${var.name}-${var.environment}"
  azs    = slice(data.aws_availability_zones.available.names, 0, 3)
  tags = {
    Project     = "cde-iso19650"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------
# Rete: un NAT per AZ (nessun punto singolo di guasto in uscita)
# ---------------------------------------------------------------------
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.16"

  name = local.prefix
  cidr = var.vpc_cidr
  azs  = local.azs

  public_subnets      = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i)]
  private_subnets     = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i + 10)]
  database_subnets    = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i + 20)]
  elasticache_subnets = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i + 30)]

  create_database_subnet_group    = true
  create_elasticache_subnet_group = true
  enable_nat_gateway              = true
  single_nat_gateway              = false
  one_nat_gateway_per_az          = true
  enable_dns_hostnames            = true

  enable_flow_log                                 = true
  create_flow_log_cloudwatch_log_group            = true
  create_flow_log_cloudwatch_iam_role             = true
  flow_log_cloudwatch_log_group_retention_in_days = 365
}

# Endpoint S3 di tipo gateway: il traffico dei documenti non passa dai NAT.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = module.vpc.vpc_id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = module.vpc.private_route_table_ids
}

# ---------------------------------------------------------------------
# KMS
# ---------------------------------------------------------------------
module "kms_data" {
  source  = "terraform-aws-modules/kms/aws"
  version = "~> 3.1"

  description             = "${local.prefix} cifratura dati a riposo (RDS, S3, Secrets Manager, log)"
  aliases                 = ["${local.prefix}-data"]
  enable_key_rotation     = true
  deletion_window_in_days = 30

  key_statements = [{
    sid       = "CloudWatchLogs"
    actions   = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
    resources = ["*"]
    principals = [{
      type        = "Service"
      identifiers = ["logs.${var.region}.amazonaws.com"]
    }]
  }]
}

module "kms_app" {
  source  = "terraform-aws-modules/kms/aws"
  version = "~> 3.1"

  description             = "${local.prefix} envelope encryption segreti MFA (GenerateDataKey)"
  aliases                 = ["${local.prefix}-app"]
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

module "kms_dr" {
  source  = "terraform-aws-modules/kms/aws"
  version = "~> 3.1"
  providers = {
    aws = aws.dr
  }

  description             = "${local.prefix} cifratura copie di disaster recovery"
  aliases                 = ["${local.prefix}-dr"]
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

# ---------------------------------------------------------------------
# Security group
# ---------------------------------------------------------------------
resource "aws_security_group" "api" {
  name        = "${local.prefix}-api"
  description = "Task ECS API, worker e migrazioni"
  vpc_id      = module.vpc.vpc_id

  egress {
    description = "Uscita verso AWS API, RDS, Redis, TSA"
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

resource "aws_security_group" "redis" {
  name        = "${local.prefix}-redis"
  description = "Redis (rate limit) raggiungibile solo dai task API"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "Redis TLS dai task API"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }
}

# ---------------------------------------------------------------------
# PostgreSQL 16 — Multi-AZ, PITR 35 giorni, backup automatici replicati in DR
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

  allocated_storage     = 200
  max_allocated_storage = 2000
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = module.kms_data.key_arn

  db_name                                = null # creato da `cde bootstrap-db` con proprietario cde_owner
  username                               = "cde_master"
  manage_master_user_password            = true
  master_user_secret_kms_key_id          = module.kms_data.key_arn
  iam_database_authentication_enabled    = true
  multi_az                               = true
  db_subnet_group_name                   = module.vpc.database_subnet_group_name
  vpc_security_group_ids                 = [aws_security_group.db.id]
  backup_retention_period                = var.db_backup_retention_days
  backup_window                          = "01:00-02:00"
  maintenance_window                     = "Sun:03:00-Sun:04:00"
  deletion_protection                    = true
  skip_final_snapshot                    = false
  final_snapshot_identifier_prefix       = "${local.prefix}-final"
  copy_tags_to_snapshot                  = true
  performance_insights_enabled           = true
  performance_insights_kms_key_id        = module.kms_data.key_arn
  performance_insights_retention_period  = 31
  monitoring_interval                    = 30
  create_monitoring_role                 = true
  enabled_cloudwatch_logs_exports        = ["postgresql", "upgrade"]
  create_cloudwatch_log_group            = true
  cloudwatch_log_group_retention_in_days = 365
  auto_minor_version_upgrade             = true
  apply_immediately                      = false

  parameters = [
    { name = "rds.force_ssl", value = "1" },
    { name = "log_statement", value = "ddl" },
    { name = "log_min_duration_statement", value = "500" },
    { name = "log_connections", value = "1" },
    { name = "log_disconnections", value = "1" },
  ]
}

# PITR anche nella regione DR: base del ripristino se la regione primaria non è disponibile.
resource "aws_db_instance_automated_backups_replication" "dr" {
  provider               = aws.dr
  source_db_instance_arn = module.db.db_instance_arn
  kms_key_id             = module.kms_dr.key_arn
  retention_period       = 7
}

# ---------------------------------------------------------------------
# Redis (ElastiCache) per il rate limit condiviso tra i task API
# ---------------------------------------------------------------------
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${local.prefix}-redis"
  description                = "Rate limit API"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = "cache.t4g.small"
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  subnet_group_name          = module.vpc.elasticache_subnet_group_name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  kms_key_id                 = module.kms_data.key_arn
  transit_encryption_enabled = true
  snapshot_retention_limit   = 1
}

# ---------------------------------------------------------------------
# Documenti: Versioning + Object Lock COMPLIANCE + SSE-KMS, replica in DR
# ---------------------------------------------------------------------
resource "random_id" "bucket" {
  byte_length = 4
}

locals {
  documents_bucket_name = "${local.prefix}-documents-${random_id.bucket.hex}"
}

module "documents_bucket" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 4.2"

  bucket              = local.documents_bucket_name
  object_lock_enabled = true

  versioning = {
    enabled = true
  }

  object_lock_configuration = {
    rule = {
      default_retention = {
        mode = "COMPLIANCE"
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
    allowed_origins = ["https://${var.domain_name}"]
    allowed_headers = ["Content-Type", "Content-MD5", "x-amz-checksum-sha256", "x-amz-sdk-checksum-algorithm"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }]

  lifecycle_rule = [{
    id                                     = "abort-incomplete-multipart"
    enabled                                = true
    abort_incomplete_multipart_upload_days = 7
  }]

  logging = {
    target_bucket = module.access_logs_bucket.s3_bucket_id
    target_prefix = "s3/documents/"
  }
}

module "documents_dr_bucket" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 4.2"
  providers = {
    aws = aws.dr
  }

  bucket              = "${local.documents_bucket_name}-dr"
  object_lock_enabled = true

  versioning = {
    enabled = true
  }

  object_lock_configuration = {
    rule = {
      default_retention = {
        mode = "COMPLIANCE"
        days = var.object_lock_days
      }
    }
  }

  server_side_encryption_configuration = {
    rule = {
      apply_server_side_encryption_by_default = {
        sse_algorithm     = "aws:kms"
        kms_master_key_id = module.kms_dr.key_arn
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
}

data "aws_iam_policy_document" "replication_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "replication" {
  name               = "${local.prefix}-s3-replication"
  assume_role_policy = data.aws_iam_policy_document.replication_assume.json
}

data "aws_iam_policy_document" "replication" {
  statement {
    actions   = ["s3:GetReplicationConfiguration", "s3:ListBucket"]
    resources = [module.documents_bucket.s3_bucket_arn]
  }
  statement {
    actions = ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging",
    "s3:GetObjectRetention", "s3:GetObjectLegalHold"]
    resources = ["${module.documents_bucket.s3_bucket_arn}/*"]
  }
  statement {
    actions   = ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags", "s3:ObjectOwnerOverrideToBucketOwner"]
    resources = ["${module.documents_dr_bucket.s3_bucket_arn}/*"]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [module.kms_data.key_arn]
  }
  statement {
    actions   = ["kms:Encrypt", "kms:GenerateDataKey"]
    resources = [module.kms_dr.key_arn]
  }
}

resource "aws_iam_role_policy" "replication" {
  role   = aws_iam_role.replication.id
  policy = data.aws_iam_policy_document.replication.json
}

resource "aws_s3_bucket_replication_configuration" "documents" {
  bucket = module.documents_bucket.s3_bucket_id
  role   = aws_iam_role.replication.arn

  rule {
    id     = "dr"
    status = "Enabled"

    filter {}

    delete_marker_replication {
      status = "Disabled"
    }

    source_selection_criteria {
      sse_kms_encrypted_objects {
        status = "Enabled"
      }
    }

    destination {
      bucket        = module.documents_dr_bucket.s3_bucket_arn
      storage_class = "STANDARD_IA"

      encryption_configuration {
        replica_kms_key_id = module.kms_dr.key_arn
      }

      # RTC: il 99,99% degli oggetti replicato entro 15', coerente con l'RPO dichiarato
      replication_time {
        status = "Enabled"
        time {
          minutes = 15
        }
      }

      metrics {
        status = "Enabled"
        event_threshold {
          minutes = 15
        }
      }
    }
  }
}

# Log di accesso (S3, ALB, CloudFront): retention 1 anno, poi eliminazione.
module "access_logs_bucket" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 4.2"

  bucket = "${local.prefix}-access-logs-${random_id.bucket.hex}"

  block_public_acls        = true
  block_public_policy      = true
  ignore_public_acls       = true
  restrict_public_buckets  = true
  control_object_ownership = true
  object_ownership         = "BucketOwnerPreferred"

  attach_elb_log_delivery_policy        = true
  attach_lb_log_delivery_policy         = true
  attach_access_log_delivery_policy     = true
  attach_deny_insecure_transport_policy = true

  server_side_encryption_configuration = {
    rule = {
      apply_server_side_encryption_by_default = {
        sse_algorithm = "AES256"
      }
    }
  }

  lifecycle_rule = [{
    id         = "retention"
    enabled    = true
    expiration = { days = 365 }
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

resource "aws_secretsmanager_secret" "db_dsn" {
  for_each    = toset(["cde_owner", "cde_app", "cde_auth", "cde_worker"])
  name        = "${local.prefix}/db/${each.key}"
  description = "DSN completo (postgresql://...?sslmode=verify-full) del ruolo PostgreSQL ${each.key}"
  kms_key_id  = module.kms_data.key_arn
}
