# "><(((º> sabusabu <º)))><"
# Calcolo: ECS Fargate. Una sola immagine (apps/api/Dockerfile) per API, worker e migrazioni.
#   api      uvicorn dietro ALB, 2..N task con autoscaling
#   worker   Procrastinate + sidecar ClamAV (scanner=clamd su localhost)
#   migrate  task una tantum lanciato dalla pipeline prima del deploy (cde migrate, ruolo owner)

resource "aws_ecr_repository" "api" {
  name                 = "${local.prefix}-api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = module.kms_data.key_arn
  }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Ultime 50 immagini"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 50 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_ecs_cluster" "main" {
  name = local.prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "ecs" {
  for_each          = toset(["api", "worker", "clamav", "migrate"])
  name              = "/ecs/${local.prefix}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = module.kms_data.key_arn
}

# ---------------------------------------------------------------------
# IAM: ruolo di esecuzione (pull immagine, log, DSN) e ruoli dei task (privilegio minimo)
# ---------------------------------------------------------------------
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "${local.prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [for s in aws_secretsmanager_secret.db_dsn : s.arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [module.kms_data.key_arn]
  }
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution_secrets.json
}

data "aws_iam_policy_document" "app" {
  statement {
    sid       = "Documenti"
    actions   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:PutObjectRetention", "s3:GetObjectRetention", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"]
    resources = ["${module.documents_bucket.s3_bucket_arn}/*"]
  }
  statement {
    sid       = "DocumentiBucket"
    actions   = ["s3:ListBucket", "s3:GetBucketObjectLockConfiguration"]
    resources = [module.documents_bucket.s3_bucket_arn]
  }
  statement {
    sid       = "Cifratura"
    actions   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"]
    resources = [module.kms_data.key_arn, module.kms_app.key_arn]
  }
  statement {
    sid       = "ChiaveJwt"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.jwt_private_key.arn]
  }
  statement {
    sid       = "Email"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "ses:FromAddress"
      values   = [regex("<(.+)>", var.mail_from)[0]]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${local.prefix}-app"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "app" {
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}

# Le migrazioni non toccano S3 né KMS: ruolo senza permessi applicativi.
resource "aws_iam_role" "migrate" {
  name               = "${local.prefix}-migrate"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# ---------------------------------------------------------------------
# Definizioni dei task
# ---------------------------------------------------------------------
locals {
  image = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"

  app_environment = [for k, v in {
    CDE_ENV                       = var.environment
    CDE_KMS_PROVIDER              = "aws"
    CDE_AWS_REGION                = var.region
    CDE_AWS_KMS_KEY_ID            = module.kms_app.key_arn
    CDE_JWT_PRIVATE_KEY_SECRET_ID = aws_secretsmanager_secret.jwt_private_key.arn
    CDE_JWT_ISSUER                = "https://${var.domain_name}"
    CDE_RATE_LIMIT_STORAGE        = "rediss://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
    CDE_WEB_BASE_URL              = "https://${var.domain_name}"
    CDE_CORS_ORIGINS              = jsonencode(["https://${var.domain_name}"])
    CDE_REFRESH_COOKIE_PATH       = "/api/auth"
    CDE_CLIENT_IP_HEADER          = "cloudfront-viewer-address"
    CDE_COOKIE_SECURE             = "true"
    CDE_S3_BUCKET                 = module.documents_bucket.s3_bucket_id
    CDE_AUDIT_LOCK_MODE           = var.object_lock_mode
    CDE_TSA_URL                   = var.tsa_url
    CDE_SCANNER                   = "clamd"
    CDE_CLAMD_HOST                = "127.0.0.1"
    CDE_MAILER                    = "ses"
    CDE_MAIL_FROM                 = var.mail_from
    CDE_DB_POOL_MAX               = "20"
    AWS_STS_REGIONAL_ENDPOINTS    = "regional"
    PYTHONUNBUFFERED              = "1"
  } : { name = k, value = v } if v != ""]

  app_secrets = [
    { name = "CDE_DATABASE_URL_APP", valueFrom = aws_secretsmanager_secret.db_dsn["cde_app"].arn },
    { name = "CDE_DATABASE_URL_AUTH", valueFrom = aws_secretsmanager_secret.db_dsn["cde_auth"].arn },
    { name = "CDE_DATABASE_URL_WORKER", valueFrom = aws_secretsmanager_secret.db_dsn["cde_worker"].arn },
  ]

  log_options = { for k, g in aws_cloudwatch_log_group.ecs : k => {
    logDriver = "awslogs"
    options = {
      awslogs-group         = g.name
      awslogs-region        = var.region
      awslogs-stream-prefix = k
    }
  } }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.app.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name                   = "api"
    image                  = local.image
    essential              = true
    readonlyRootFilesystem = true
    user                   = "10001"
    portMappings           = [{ containerPort = 8000, protocol = "tcp" }]
    environment            = local.app_environment
    secrets                = local.app_secrets
    mountPoints            = [{ sourceVolume = "tmp", containerPath = "/tmp" }]
    logConfiguration       = local.log_options["api"]
    healthCheck = {
      command     = ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"]
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])

  volume {
    name = "tmp"
  }
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.prefix}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 4096 # ClamAV carica le firme in memoria (~1,5 GB)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.app.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name                   = "worker"
      image                  = local.image
      essential              = true
      readonlyRootFilesystem = true
      user                   = "10001"
      command                = ["cde", "worker"]
      environment            = local.app_environment
      secrets                = local.app_secrets
      mountPoints            = [{ sourceVolume = "tmp", containerPath = "/tmp" }]
      logConfiguration       = local.log_options["worker"]
      dependsOn              = [{ containerName = "clamav", condition = "HEALTHY" }]
    },
    {
      name             = "clamav"
      image            = "clamav/clamav-debian:1.4"
      essential        = true
      logConfiguration = local.log_options["clamav"]
      healthCheck = {
        command     = ["CMD-SHELL", "clamdcheck.sh"]
        interval    = 30
        timeout     = 10
        retries     = 5
        startPeriod = 300
      }
    },
  ])

  volume {
    name = "tmp"
  }
}

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.prefix}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.migrate.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name                   = "migrate"
    image                  = local.image
    essential              = true
    readonlyRootFilesystem = true
    user                   = "10001"
    command                = ["cde", "migrate"]
    secrets                = [{ name = "CDE_DATABASE_URL_OWNER", valueFrom = aws_secretsmanager_secret.db_dsn["cde_owner"].arn }]
    logConfiguration       = local.log_options["migrate"]
  }])
}

# Primo avvio e rotazione password dei ruoli PostgreSQL: `cde bootstrap-db` con l'utente master,
# che scrive i DSN nei segreti db/* e applica le migrazioni (docs/runbook.md).
resource "aws_iam_role" "db_bootstrap" {
  name               = "${local.prefix}-db-bootstrap"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "db_bootstrap" {
  statement {
    actions   = ["secretsmanager:PutSecretValue", "secretsmanager:GetSecretValue"]
    resources = [for s in aws_secretsmanager_secret.db_dsn : s.arn]
  }
  statement {
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
    resources = [module.kms_data.key_arn]
  }
}

resource "aws_iam_role_policy" "db_bootstrap" {
  role   = aws_iam_role.db_bootstrap.id
  policy = data.aws_iam_policy_document.db_bootstrap.json
}

data "aws_iam_policy_document" "ecs_execution_master" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [module.db.db_instance_master_user_secret_arn]
  }
}

resource "aws_iam_role_policy" "ecs_execution_master" {
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution_master.json
}

resource "aws_ecs_task_definition" "db_bootstrap" {
  family                   = "${local.prefix}-db-bootstrap"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.db_bootstrap.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name                   = "db-bootstrap"
    image                  = local.image
    essential              = true
    readonlyRootFilesystem = true
    user                   = "10001"
    command = ["cde", "bootstrap-db", "--host", module.db.db_instance_address,
    "--secret-prefix", "${local.prefix}/db"]
    environment = [{ name = "CDE_AWS_REGION", value = var.region }]
    secrets = [
      { name = "CDE_DB_MASTER_USER", valueFrom = "${module.db.db_instance_master_user_secret_arn}:username::" },
      { name = "CDE_DB_MASTER_PASSWORD", valueFrom = "${module.db.db_instance_master_user_secret_arn}:password::" },
    ]
    logConfiguration = local.log_options["migrate"]
  }])
}

# ---------------------------------------------------------------------
# Servizi
# ---------------------------------------------------------------------
resource "aws_ecs_service" "api" {
  name                              = "api"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.api.arn
  desired_count                     = var.api_min_tasks
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60
  enable_execute_command            = false
  propagate_tags                    = "SERVICE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 8000
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [desired_count] # gestito dall'autoscaling
  }

  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "worker" {
  name            = "worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_tasks
  launch_type     = "FARGATE"
  propagate_tags  = "SERVICE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

resource "aws_appautoscaling_target" "api" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.api_min_tasks
  max_capacity       = var.api_max_tasks
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${local.prefix}-api-cpu"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  policy_type        = "TargetTrackingScaling"

  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# Dai test di carico (docs/prestazioni.md): ~150 req/s per task con p95 < 200 ms.
resource "aws_appautoscaling_policy" "api_requests" {
  name               = "${local.prefix}-api-requests"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  policy_type        = "TargetTrackingScaling"

  target_tracking_scaling_policy_configuration {
    target_value       = 6000 # richieste al minuto per task (~100 req/s, margine sul limite misurato)
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.api.arn_suffix}/${aws_lb_target_group.api.arn_suffix}"
    }
  }
}
