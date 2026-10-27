# "><(((º> sabusabu <º)))><"
# terraform test del modulo: plan/apply con provider simulati (nessuna credenziale AWS). Verifica che lo stack si
# pianifichi senza cicli e che i requisiti di G58 non vengano allentati per errore.

mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["eu-south-1a", "eu-south-1b", "eu-south-1c"] }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_region" {
    defaults = { name = "eu-south-1", id = "eu-south-1" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws", dns_suffix = "amazonaws.com" }
  }
  # I provider simulati inventano stringhe casuali: gli attributi validati come ARN vanno forniti.
  mock_resource "aws_lb_listener" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-south-1:123456789012:listener/app/mock/0123456789abcdef/0123456789abcdef" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:eu-south-1:123456789012:log-group:mock" }
  }
  mock_resource "aws_iam_policy" {
    defaults = { arn = "arn:aws:iam::123456789012:policy/mock" }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:eu-south-1:123456789012:key/00000000-0000-0000-0000-000000000000" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/mock" }
  }
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-south-1:123456789012:loadbalancer/app/mock/0123456789abcdef", arn_suffix = "app/mock/0123456789abcdef" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-south-1:123456789012:targetgroup/mock/0123456789abcdef", arn_suffix = "targetgroup/mock/0123456789abcdef" }
  }
  mock_resource "aws_cloudfront_function" {
    defaults = { arn = "arn:aws:cloudfront::123456789012:function/mock" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::mock" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:eu-south-1:123456789012:mock" }
  }
  mock_resource "aws_backup_vault" {
    defaults = { arn = "arn:aws:backup:eu-central-1:123456789012:backup-vault:mock" }
  }
  mock_resource "aws_wafv2_web_acl" {
    defaults = { arn = "arn:aws:wafv2:us-east-1:123456789012:global/webacl/mock/00000000-0000-0000-0000-000000000000" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:eu-south-1:123456789012:secret:mock" }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = { arn = "arn:aws:cloudfront::123456789012:distribution/MOCK" }
  }
  mock_resource "aws_db_instance" {
    defaults = {
      arn                = "arn:aws:rds:eu-south-1:123456789012:db:mock"
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:eu-south-1:123456789012:secret:rds-master", kms_key_id = "", secret_status = "active" }]
    }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = { arn = "arn:aws:ecs:eu-south-1:123456789012:task-definition/mock:1" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:eu-south-1:123456789012:cluster/mock" }
  }
}

mock_provider "aws" {
  alias = "us_east_1"
  # I provider simulati inventano stringhe casuali: gli attributi validati come ARN vanno forniti.
  mock_resource "aws_lb_listener" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-south-1:123456789012:listener/app/mock/0123456789abcdef/0123456789abcdef" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:eu-south-1:123456789012:log-group:mock" }
  }
  mock_resource "aws_iam_policy" {
    defaults = { arn = "arn:aws:iam::123456789012:policy/mock" }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:eu-south-1:123456789012:key/00000000-0000-0000-0000-000000000000" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/mock" }
  }
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-south-1:123456789012:loadbalancer/app/mock/0123456789abcdef", arn_suffix = "app/mock/0123456789abcdef" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-south-1:123456789012:targetgroup/mock/0123456789abcdef", arn_suffix = "targetgroup/mock/0123456789abcdef" }
  }
  mock_resource "aws_cloudfront_function" {
    defaults = { arn = "arn:aws:cloudfront::123456789012:function/mock" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::mock" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:eu-south-1:123456789012:mock" }
  }
  mock_resource "aws_backup_vault" {
    defaults = { arn = "arn:aws:backup:eu-central-1:123456789012:backup-vault:mock" }
  }
  mock_resource "aws_wafv2_web_acl" {
    defaults = { arn = "arn:aws:wafv2:us-east-1:123456789012:global/webacl/mock/00000000-0000-0000-0000-000000000000" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:eu-south-1:123456789012:secret:mock" }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = { arn = "arn:aws:cloudfront::123456789012:distribution/MOCK" }
  }
  mock_resource "aws_db_instance" {
    defaults = {
      arn                = "arn:aws:rds:eu-south-1:123456789012:db:mock"
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:eu-south-1:123456789012:secret:rds-master", kms_key_id = "", secret_status = "active" }]
    }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = { arn = "arn:aws:ecs:eu-south-1:123456789012:task-definition/mock:1" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:eu-south-1:123456789012:cluster/mock" }
  }
}

mock_provider "aws" {
  alias = "dr"
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws", dns_suffix = "amazonaws.com" }
  }
  mock_data "aws_region" {
    defaults = { name = "eu-central-1", id = "eu-central-1" }
  }
  # I provider simulati inventano stringhe casuali: gli attributi validati come ARN vanno forniti.
  mock_resource "aws_lb_listener" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-south-1:123456789012:listener/app/mock/0123456789abcdef/0123456789abcdef" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:eu-south-1:123456789012:log-group:mock" }
  }
  mock_resource "aws_iam_policy" {
    defaults = { arn = "arn:aws:iam::123456789012:policy/mock" }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:eu-south-1:123456789012:key/00000000-0000-0000-0000-000000000000" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/mock" }
  }
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-south-1:123456789012:loadbalancer/app/mock/0123456789abcdef", arn_suffix = "app/mock/0123456789abcdef" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-south-1:123456789012:targetgroup/mock/0123456789abcdef", arn_suffix = "targetgroup/mock/0123456789abcdef" }
  }
  mock_resource "aws_cloudfront_function" {
    defaults = { arn = "arn:aws:cloudfront::123456789012:function/mock" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::mock" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:eu-south-1:123456789012:mock" }
  }
  mock_resource "aws_backup_vault" {
    defaults = { arn = "arn:aws:backup:eu-central-1:123456789012:backup-vault:mock" }
  }
  mock_resource "aws_wafv2_web_acl" {
    defaults = { arn = "arn:aws:wafv2:us-east-1:123456789012:global/webacl/mock/00000000-0000-0000-0000-000000000000" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:eu-south-1:123456789012:secret:mock" }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = { arn = "arn:aws:cloudfront::123456789012:distribution/MOCK" }
  }
  mock_resource "aws_db_instance" {
    defaults = {
      arn                = "arn:aws:rds:eu-south-1:123456789012:db:mock"
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:eu-south-1:123456789012:secret:rds-master", kms_key_id = "", secret_status = "active" }]
    }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = { arn = "arn:aws:ecs:eu-south-1:123456789012:task-definition/mock:1" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:eu-south-1:123456789012:cluster/mock" }
  }
}

variables {
  environment                = "prod"
  domain_name                = "cde.example.com"
  cloudfront_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/test"
  alb_certificate_arn        = "arn:aws:acm:eu-south-1:123456789012:certificate/test"
  alert_emails               = ["ops@example.com"]
  image_tag                  = "test"
}

run "requisiti_produzione" {
  command = apply # provider simulati: nessuna risorsa reale, valori calcolati inventati

  assert {
    condition     = module.db.db_instance_identifier != "" && var.db_backup_retention_days == 35
    error_message = "PITR del database: 35 giorni"
  }

  assert {
    condition     = aws_backup_vault_lock_configuration.main.min_retention_days >= 35
    error_message = "Vault lock dei backup sotto i 35 giorni"
  }

  assert {
    condition     = aws_s3_bucket_replication_configuration.documents[0].rule[0].destination[0].replication_time[0].time[0].minutes == 15
    error_message = "Replica dei documenti con RTC a 15' (RPO)"
  }

  assert {
    condition     = aws_lb_listener.https.default_action[0].type == "fixed-response"
    error_message = "L'ALB deve rifiutare il traffico che non arriva da CloudFront"
  }

  assert {
    condition     = aws_cloudfront_distribution.main.viewer_certificate[0].minimum_protocol_version == "TLSv1.2_2021"
    error_message = "TLS minimo 1.2 sull'edge"
  }

  assert {
    condition     = length([for e in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment : e if e.name == "CDE_AUDIT_LOCK_MODE" && e.value == "COMPLIANCE"]) == 1
    error_message = "Ancore del registro attività in COMPLIANCE"
  }

  assert {
    condition     = aws_ecs_service.api.deployment_circuit_breaker[0].rollback
    error_message = "Rollback automatico dei deploy falliti"
  }
}

run "mittente_email_valido" {
  command = plan

  variables {
    mail_from = "senza-indirizzo"
  }

  expect_failures = [var.mail_from]
}

run "staging_senza_dr" {
  command = apply

  variables {
    environment      = "staging"
    enable_dr        = false
    db_multi_az      = false
    nat_per_az       = false
    object_lock_mode = "GOVERNANCE"
    object_lock_days = 30
  }

  assert {
    condition     = length(aws_s3_bucket_replication_configuration.documents) == 0 && length(aws_backup_vault.dr) == 0
    error_message = "Senza DR non si crea niente nella regione di disaster recovery"
  }

  assert {
    condition     = length(aws_backup_plan.db.rule) == 2 && alltrue([for r in aws_backup_plan.db.rule : length(r.copy_action) == 0])
    error_message = "Senza DR i backup non si copiano altrove"
  }

  assert {
    condition     = length([for e in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment : e if e.name == "CDE_AUDIT_LOCK_MODE" && e.value == "GOVERNANCE"]) == 1
    error_message = "Lock delle ancore coerente con l'ambiente"
  }

  assert {
    condition     = !contains(keys(aws_cloudwatch_metric_alarm.this), "s3-replication-latency")
    error_message = "Nessun allarme di replica senza replica"
  }
}
