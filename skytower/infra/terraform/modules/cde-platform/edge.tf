# "><(((º> sabusabu <º)))><"
# Ingresso: un solo origin pubblico (CloudFront + WAF). SPA da S3 privato, API sotto /api verso l'ALB.
# Stesso origin per SPA e API: il refresh token resta in cookie SameSite=Strict con path /api/auth.

# ---------------------------------------------------------------------
# ALB: raggiungibile solo da CloudFront (prefix list gestita + header segreto)
# ---------------------------------------------------------------------
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${local.prefix}-alb"
  description = "ALB: HTTPS solo dagli edge CloudFront"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "HTTPS da CloudFront"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  egress {
    description     = "Verso i task API"
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }
}

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  description                  = "API da ALB"
  from_port                    = 8000
  to_port                      = 8000
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.alb.id
}

# Segreto condiviso CloudFront → ALB: senza, l'ALB risponde 403 anche a chi aggira la prefix list.
resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

resource "aws_lb" "api" {
  name                       = "${local.prefix}-api"
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = module.vpc.public_subnets
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = true
  idle_timeout               = 120 # stream SSE delle notifiche

  access_logs {
    bucket  = module.access_logs_bucket.s3_bucket_id
    prefix  = "alb"
    enabled = true
  }
}

resource "aws_lb_target_group" "api" {
  name                 = "${local.prefix}-api"
  port                 = 8000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = module.vpc.vpc_id
  deregistration_delay = 30

  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.alb_certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin_verify.result]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# ---------------------------------------------------------------------
# SPA: bucket privato letto solo da CloudFront (OAC)
# ---------------------------------------------------------------------
module "web_bucket" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 4.2"

  bucket = "${local.prefix}-web-${random_id.bucket.hex}"

  block_public_acls        = true
  block_public_policy      = true
  ignore_public_acls       = true
  restrict_public_buckets  = true
  control_object_ownership = true
  object_ownership         = "BucketOwnerEnforced"

  versioning = {
    enabled = true # rollback della SPA = ripristino della versione precedente
  }

  server_side_encryption_configuration = {
    rule = {
      apply_server_side_encryption_by_default = {
        sse_algorithm = "AES256"
      }
    }
  }

  attach_deny_insecure_transport_policy = true
  attach_policy                         = true
  policy                                = data.aws_iam_policy_document.web_bucket.json
}

data "aws_iam_policy_document" "web_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${local.prefix}-web-${random_id.bucket.hex}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.main.arn]
    }
  }
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${local.prefix}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# /api/x → /x verso l'API; percorsi della SPA senza estensione → /index.html (routing lato client).
resource "aws_cloudfront_function" "api_prefix" {
  name    = "${local.prefix}-api-prefix"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var r = event.request;
      r.uri = r.uri.replace(/^\/api(?=\/|$)/, '') || '/';
      return r;
    }
  EOT
}

resource "aws_cloudfront_function" "spa_routing" {
  name    = "${local.prefix}-spa-routing"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var r = event.request;
      if (!/\.[a-z0-9]+$/i.test(r.uri)) { r.uri = '/index.html'; }
      return r;
    }
  EOT
}

locals {
  s3_regional = "https://${local.documents_bucket_name}.s3.${var.region}.amazonaws.com"
  spa_csp = join("; ", [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'", # web-ifc (viewer IFC) compila WebAssembly
    "worker-src 'self' blob:",              # PDF.js
    "style-src 'self' 'unsafe-inline'",     # MUI/emotion
    "img-src 'self' data: blob: ${local.s3_regional}",
    "font-src 'self' data:",
    "connect-src 'self' ${local.s3_regional}", # upload/download diretti con URL presigned
    "frame-src 'self' blob: ${local.s3_regional}",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ])
}

resource "aws_cloudfront_response_headers_policy" "spa" {
  name = "${local.prefix}-spa"

  security_headers_config {
    content_security_policy {
      content_security_policy = local.spa_csp
      override                = true
    }
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
  }
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

# Tutto ciò che il browser invia (tranne Host) più l'IP del viewer, che l'API usa al posto di
# X-Forwarded-For (falsificabile dal client): CDE_CLIENT_IP_HEADER in ecs.tf.
resource "aws_cloudfront_origin_request_policy" "api" {
  name = "${local.prefix}-api"

  headers_config {
    header_behavior = "allViewerAndWhitelistCloudFront"
    headers {
      items = ["CloudFront-Viewer-Address"]
    }
  }
  cookies_config {
    cookie_behavior = "all"
  }
  query_strings_config {
    query_string_behavior = "all"
  }
}

resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  price_class         = "PriceClass_100"
  aliases             = [var.domain_name]
  default_root_object = "index.html"
  web_acl_id          = aws_wafv2_web_acl.main.arn
  comment             = "${local.prefix} SPA + API"

  origin {
    origin_id                = "web"
    domain_name              = module.web_bucket.s3_bucket_bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id   = "api"
    domain_name = "origin.${var.domain_name}"

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 60
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }
  }

  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.spa.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_routing.arn
    }
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "api"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.api.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.api_prefix.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.cloudfront_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  logging_config {
    bucket          = module.access_logs_bucket.s3_bucket_bucket_domain_name
    prefix          = "cloudfront/"
    include_cookies = false
  }
}

# ---------------------------------------------------------------------
# WAF (scope CLOUDFRONT, quindi in us-east-1)
# ---------------------------------------------------------------------
resource "aws_wafv2_web_acl" "main" {
  provider = aws.us_east_1
  name     = "${local.prefix}-edge"
  scope    = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "ip-reputation"
    priority = 0
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  # Login, refresh e reset: limite stretto per IP (il rate limit applicativo resta per account).
  rule {
    name     = "rate-auth"
    priority = 1
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 100
        aggregate_key_type = "IP"
        scope_down_statement {
          byte_match_statement {
            search_string         = "/api/auth/"
            positional_constraint = "STARTS_WITH"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-auth"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-global"
    priority = 2
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-global"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "common"
    priority = 3
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        # Salvataggio dei file di testo e corpi delle annotazioni superano gli 8 KB: solo conteggio.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "known-bad-inputs"
    priority = 4
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "sqli"
    priority = 5
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesSQLiRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "sqli"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.prefix}-edge"
    sampled_requests_enabled   = true
  }
}
