# "><(((º> sabusabu <º)))><"
variable "region" {
  description = "Regione AWS (dati in UE)"
  type        = string
  default     = "eu-south-1"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "name" {
  description = "Prefisso risorse"
  type        = string
  default     = "cde"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "db_multi_az" {
  description = "Multi-AZ: false in dev, true in staging/prod"
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "PITR: 7 in dev, 35 in prod"
  type        = number
  default     = 7
}

variable "web_origins" {
  description = "Origin autorizzati all'upload diretto su S3 (CORS)"
  type        = list(string)
  default     = ["http://localhost:5173"]
}

variable "object_lock_mode" {
  description = "GOVERNANCE in dev (rimovibile con permesso dedicato), COMPLIANCE in prod (irreversibile)"
  type        = string
  default     = "GOVERNANCE"
  validation {
    condition     = contains(["GOVERNANCE", "COMPLIANCE"], var.object_lock_mode)
    error_message = "object_lock_mode deve essere GOVERNANCE o COMPLIANCE."
  }
}

variable "object_lock_days" {
  description = "Retention di default delle versioni dei documenti"
  type        = number
  default     = 1
}
