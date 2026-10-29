# "><(((º> sabusabu <º)))><"
# Staging: stessa piattaforma della produzione (G56 test di carico, G57 pentest, G59 UAT) con taglie ridotte,
# senza regione DR e con Object Lock GOVERNANCE a 30 giorni (i dati di prova si possono cancellare).
module "platform" {
  source = "../../modules/cde-platform"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
    aws.dr        = aws.dr
  }

  environment                = var.environment
  region                     = var.region
  dr_region                  = var.dr_region
  domain_name                = var.domain_name
  cloudfront_certificate_arn = var.cloudfront_certificate_arn
  alb_certificate_arn        = var.alb_certificate_arn
  alert_emails               = var.alert_emails
  image_tag                  = var.image_tag
  tsa_url                    = var.tsa_url
  onlyoffice_url             = var.onlyoffice_url
  onlyoffice_jwt_secret_arn  = var.onlyoffice_jwt_secret_arn
  mail_from                  = var.mail_from

  vpc_cidr                 = "10.60.0.0/16"
  enable_dr                = false
  nat_per_az               = false
  db_multi_az              = false
  db_instance_class        = "db.t4g.large"
  db_allocated_storage     = 50
  db_backup_retention_days = 7
  redis_node_type          = "cache.t4g.micro"
  log_retention_days       = 90
  object_lock_mode         = "GOVERNANCE"
  object_lock_days         = 30
  api_min_tasks            = 2 # come in produzione: il test di carico misura l'autoscaling reale
  api_max_tasks            = 6
  worker_tasks             = 1
  # i generatori del test di carico escono da pochi IP: il limite per IP di produzione li bloccherebbe
  waf_rate_limit_per_5min = 100000
}
