# "><(((º> sabusabu <º)))><"
# Allarmi operativi → SNS (email). Soglie dai test di carico (docs/prestazioni.md) e dagli SLO del runbook.

resource "aws_sns_topic" "alerts" {
  name              = "${local.prefix}-alerts"
  kms_master_key_id = module.kms_data.key_id
}

resource "aws_sns_topic_subscription" "alerts_email" {
  for_each  = toset(var.alert_emails)
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

locals {
  alb_dims = {
    LoadBalancer = aws_lb.api.arn_suffix
    TargetGroup  = aws_lb_target_group.api.arn_suffix
  }

  alarms = {
    api-5xx = {
      description = "Errori 5xx dell'API oltre 20 in 5 minuti"
      namespace   = "AWS/ApplicationELB"
      metric      = "HTTPCode_Target_5XX_Count"
      dimensions  = local.alb_dims
      statistic   = "Sum"
      period      = 300
      threshold   = 20
      operator    = "GreaterThanThreshold"
    }
    api-latency-p95 = {
      description = "p95 dell'API oltre 500 ms per 15 minuti (misurato: < 200 ms)"
      namespace   = "AWS/ApplicationELB"
      metric      = "TargetResponseTime"
      dimensions  = local.alb_dims
      extended    = "p95"
      period      = 300
      evaluations = 3
      threshold   = 0.5
      operator    = "GreaterThanThreshold"
    }
    api-unhealthy = {
      description = "Task API non sani dietro l'ALB"
      namespace   = "AWS/ApplicationELB"
      metric      = "UnHealthyHostCount"
      dimensions  = local.alb_dims
      statistic   = "Maximum"
      period      = 60
      evaluations = 3
      threshold   = 0
      operator    = "GreaterThanThreshold"
    }
    worker-down = {
      description = "Nessun worker in esecuzione: verifica file, notifiche e ancore del registro ferme"
      namespace   = "ECS/ContainerInsights"
      metric      = "RunningTaskCount"
      dimensions  = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.worker.name }
      statistic   = "Minimum"
      period      = 60
      evaluations = 5
      threshold   = 1
      operator    = "LessThanThreshold"
      missing     = "breaching"
    }
    db-cpu = {
      description = "CPU del database oltre l'80% per 15 minuti"
      namespace   = "AWS/RDS"
      metric      = "CPUUtilization"
      dimensions  = { DBInstanceIdentifier = module.db.db_instance_identifier }
      statistic   = "Average"
      period      = 300
      evaluations = 3
      threshold   = 80
      operator    = "GreaterThanThreshold"
    }
    db-storage = {
      description = "Spazio libero del database sotto 20 GB"
      namespace   = "AWS/RDS"
      metric      = "FreeStorageSpace"
      dimensions  = { DBInstanceIdentifier = module.db.db_instance_identifier }
      statistic   = "Minimum"
      period      = 300
      threshold   = 20 * 1024 * 1024 * 1024
      operator    = "LessThanThreshold"
    }
    db-memory = {
      description = "Memoria libera del database sotto 1 GB"
      namespace   = "AWS/RDS"
      metric      = "FreeableMemory"
      dimensions  = { DBInstanceIdentifier = module.db.db_instance_identifier }
      statistic   = "Minimum"
      period      = 300
      evaluations = 3
      threshold   = 1024 * 1024 * 1024
      operator    = "LessThanThreshold"
    }
    redis-cpu = {
      description = "CPU di Redis oltre il 75%"
      namespace   = "AWS/ElastiCache"
      metric      = "EngineCPUUtilization"
      dimensions  = { ReplicationGroupId = aws_elasticache_replication_group.redis.id }
      statistic   = "Average"
      period      = 300
      evaluations = 3
      threshold   = 75
      operator    = "GreaterThanThreshold"
    }
    s3-replication-latency = {
      description = "Replica dei documenti in DR oltre 15 minuti (RPO a rischio)"
      namespace   = "AWS/S3"
      metric      = "ReplicationLatency"
      dimensions = {
        SourceBucket      = module.documents_bucket.s3_bucket_id
        DestinationBucket = module.documents_dr_bucket.s3_bucket_id
        RuleId            = "dr"
      }
      statistic = "Maximum"
      period    = 300
      threshold = 900
      operator  = "GreaterThanThreshold"
    }
    app-errors = {
      description = "Righe ERROR nei log di API e worker oltre 10 in 5 minuti"
      namespace   = "CDE/${local.prefix}"
      metric      = "LogErrors"
      dimensions  = {}
      statistic   = "Sum"
      period      = 300
      threshold   = 10
      operator    = "GreaterThanThreshold"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "errors" {
  for_each       = toset(["api", "worker"])
  name           = "${local.prefix}-${each.key}-errors"
  log_group_name = aws_cloudwatch_log_group.ecs[each.key].name
  pattern        = "?ERROR ?CRITICAL ?Traceback"

  metric_transformation {
    name          = "LogErrors"
    namespace     = "CDE/${local.prefix}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each = local.alarms

  alarm_name          = "${local.prefix}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dimensions
  statistic           = lookup(each.value, "extended", null) == null ? each.value.statistic : null
  extended_statistic  = lookup(each.value, "extended", null)
  period              = each.value.period
  evaluation_periods  = lookup(each.value, "evaluations", 1)
  threshold           = each.value.threshold
  comparison_operator = each.value.operator
  treat_missing_data  = lookup(each.value, "missing", "notBreaching")
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
