# "><(((º> sabusabu <º)))><"
output "cloudfront_domain" {
  description = "Destinazione del record DNS (CNAME/ALIAS) di domain_name"
  value       = aws_cloudfront_distribution.main.domain_name
}

output "cloudfront_distribution_id" {
  description = "Per l'invalidazione dopo il deploy della SPA"
  value       = aws_cloudfront_distribution.main.id
}

output "alb_dns_name" {
  description = "Destinazione del record DNS di origin.<domain_name>"
  value       = aws_lb.api.dns_name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "migrate_task_definition" {
  description = "Da lanciare (aws ecs run-task) prima di ogni deploy"
  value       = aws_ecs_task_definition.migrate.family
}

output "db_bootstrap_task_definition" {
  description = "Primo avvio e rotazione delle password dei ruoli PostgreSQL"
  value       = aws_ecs_task_definition.db_bootstrap.family
}

output "private_subnets" {
  value = module.vpc.private_subnets
}

output "api_security_group_id" {
  value = aws_security_group.api.id
}

output "web_bucket" {
  value = module.web_bucket.s3_bucket_id
}

output "documents_bucket" {
  value = module.documents_bucket.s3_bucket_id
}

output "documents_dr_bucket" {
  value = var.enable_dr ? module.documents_dr_bucket[0].s3_bucket_id : null
}

output "db_endpoint" {
  value = module.db.db_instance_endpoint
}

output "db_master_secret_arn" {
  value = module.db.db_instance_master_user_secret_arn
}

output "db_dsn_secret_arns" {
  description = "Segreti da valorizzare con i DSN dei ruoli (vedi docs/runbook.md)"
  value       = { for k, s in aws_secretsmanager_secret.db_dsn : k => s.arn }
}

output "jwt_secret_arn" {
  value = aws_secretsmanager_secret.jwt_private_key.arn
}

output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}
