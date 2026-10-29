# "><(((º> sabusabu <º)))><"
variable "region" {
  description = "Regione AWS primaria (dati in UE)"
  type        = string
  default     = "eu-south-1"
}

variable "dr_region" {
  description = "Regione di disaster recovery per copie dei backup e replica dei documenti"
  type        = string
  default     = "eu-central-1"
}

variable "environment" {
  type = string
}

variable "enable_dr" {
  description = "Replica documenti, PITR e backup nella regione DR (sempre in produzione)"
  type        = bool
  default     = true
}

variable "db_multi_az" {
  type    = bool
  default = true
}

variable "db_allocated_storage" {
  description = "GB iniziali (l'autoscaling arriva a 10 volte tanto)"
  type        = number
  default     = 200
}

variable "nat_per_az" {
  description = "Un NAT gateway per AZ (produzione) o uno solo condiviso"
  type        = bool
  default     = true
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "log_retention_days" {
  type    = number
  default = 365
}

variable "object_lock_mode" {
  description = "COMPLIANCE in produzione (irreversibile), GOVERNANCE altrove"
  type        = string
  default     = "COMPLIANCE"
  validation {
    condition     = contains(["GOVERNANCE", "COMPLIANCE"], var.object_lock_mode)
    error_message = "object_lock_mode deve essere GOVERNANCE o COMPLIANCE."
  }
}

variable "name" {
  description = "Prefisso risorse"
  type        = string
  default     = "cde"
}

variable "vpc_cidr" {
  type    = string
  default = "10.50.0.0/16"
}

variable "domain_name" {
  description = "Nome pubblico della piattaforma (SPA e API sotto /api), es. cde.example.com"
  type        = string
}

variable "cloudfront_certificate_arn" {
  description = "Certificato ACM in us-east-1 per domain_name (validato fuori da questo stack)"
  type        = string
}

variable "alb_certificate_arn" {
  description = "Certificato ACM nella regione primaria per origin.<domain_name> (origine dell'ALB)"
  type        = string
}

variable "alert_emails" {
  description = "Destinatari degli allarmi operativi"
  type        = list(string)
}

variable "image_tag" {
  description = "Tag dell'immagine API/worker su ECR (commit SHA)"
  type        = string
}

variable "db_instance_class" {
  type    = string
  default = "db.r6g.large"
}

variable "db_backup_retention_days" {
  description = "PITR: 35 giorni (massimo RDS)"
  type        = number
  default     = 35
}

variable "api_cpu" {
  type    = number
  default = 1024
}

variable "api_memory" {
  type    = number
  default = 2048
}

variable "api_min_tasks" {
  description = "Almeno 2 task su AZ diverse"
  type        = number
  default     = 2
}

variable "api_max_tasks" {
  type    = number
  default = 10
}

variable "worker_tasks" {
  type    = number
  default = 2
}

variable "object_lock_days" {
  description = "Retention delle versioni dei documenti (in COMPLIANCE è irreversibile)"
  type        = number
  default     = 3650
}

variable "waf_rate_limit_per_5min" {
  description = "Richieste per IP in 5 minuti oltre cui il WAF blocca"
  type        = number
  default     = 3000
}

variable "tsa_url" {
  description = "TSA qualificata eIDAS (RFC 3161) per le ancore del registro attività"
  type        = string
  default     = ""
}

variable "onlyoffice_url" {
  description = "Document Server OnlyOffice (https://...) per modificare Word/Excel in piattaforma; vuoto = spento (ADR-37)"
  type        = string
  default     = ""
}

variable "onlyoffice_jwt_secret_arn" {
  description = "ARN del segreto Secrets Manager con il segreto JWT condiviso con il Document Server"
  type        = string
  default     = ""
}

variable "mail_from" {
  description = "Mittente SES nel formato \"Nome <indirizzo>\" (l'indirizzo vincola la policy IAM)"
  type        = string
  default     = "CDE <no-reply@cde.example.com>"
  validation {
    condition     = can(regex("<[^@<>]+@[^@<>]+>", var.mail_from))
    error_message = "mail_from deve contenere l'indirizzo tra < >."
  }
}
