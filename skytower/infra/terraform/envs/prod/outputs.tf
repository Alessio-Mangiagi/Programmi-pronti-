# "><(((º> sabusabu <º)))><"
output "cloudfront_domain" {
  description = "Destinazione del record DNS (CNAME/ALIAS) di domain_name"
  value       = module.platform.cloudfront_domain
}

output "cloudfront_distribution_id" {
  description = "Per l'invalidazione dopo il deploy della SPA"
  value       = module.platform.cloudfront_distribution_id
}

output "alb_dns_name" {
  description = "Destinazione del record DNS di origin.<domain_name>"
  value       = module.platform.alb_dns_name
}

output "ecr_repository_url" {
  value = module.platform.ecr_repository_url
}

output "ecs_cluster" {
  value = module.platform.ecs_cluster
}

output "migrate_task_definition" {
  description = "Da lanciare (aws ecs run-task) prima di ogni deploy"
  value       = module.platform.migrate_task_definition
}

output "db_bootstrap_task_definition" {
  description = "Primo avvio e rotazione delle password dei ruoli PostgreSQL"
  value       = module.platform.db_bootstrap_task_definition
}

output "private_subnets" {
  value = module.platform.private_subnets
}

output "api_security_group_id" {
  value = module.platform.api_security_group_id
}

output "web_bucket" {
  value = module.platform.web_bucket
}

output "documents_bucket" {
  value = module.platform.documents_bucket
}

output "documents_dr_bucket" {
  value = module.platform.documents_dr_bucket
}

output "db_endpoint" {
  value = module.platform.db_endpoint
}

output "db_master_secret_arn" {
  value = module.platform.db_master_secret_arn
}

output "db_dsn_secret_arns" {
  description = "Segreti da valorizzare con i DSN dei ruoli (vedi docs/runbook.md)"
  value       = module.platform.db_dsn_secret_arns
}

output "jwt_secret_arn" {
  value = module.platform.jwt_secret_arn
}

output "alerts_topic_arn" {
  value = module.platform.alerts_topic_arn
}
