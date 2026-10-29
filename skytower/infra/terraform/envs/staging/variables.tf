# "><(((º> sabusabu <º)))><"
# Ingressi dell'ambiente: tutto il resto ha i valori di produzione come default del modulo.
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
  type    = string
  default = "staging"
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
  description = "Mittente SES nel formato \"Nome <indirizzo>\""
  type        = string
  default     = "CDE <no-reply@cde.example.com>"
}
