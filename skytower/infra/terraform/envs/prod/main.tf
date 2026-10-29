# "><(((º> sabusabu <º)))><"
# Produzione (G58): la piattaforma completa con i valori di default del modulo — Multi-AZ, PITR 35 giorni,
# Object Lock COMPLIANCE 10 anni, NAT per AZ, replica e backup nella regione DR.
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
}
