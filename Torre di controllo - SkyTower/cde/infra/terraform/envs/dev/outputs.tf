# "><(((º> sabusabu <º)))><"
output "vpc_id" {
  value = module.vpc.vpc_id
}

output "db_endpoint" {
  value = module.db.db_instance_endpoint
}

output "db_master_secret_arn" {
  value = module.db.db_instance_master_user_secret_arn
}

output "documents_bucket" {
  value = module.documents_bucket.s3_bucket_id
}

output "kms_app_key_arn" {
  description = "CDE_AWS_KMS_KEY_ID dell'API"
  value       = module.kms_app.key_arn
}

output "jwt_secret_arn" {
  description = "CDE_JWT_PRIVATE_KEY_SECRET_ID dell'API"
  value       = aws_secretsmanager_secret.jwt_private_key.arn
}

output "api_security_group_id" {
  value = aws_security_group.api.id
}
