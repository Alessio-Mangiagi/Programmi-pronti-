# "><(((º> sabusabu <º)))><"
terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Stato remoto obbligatorio in produzione. Configurazione parziale:
  #   terraform init -backend-config=backend.hcl   (vedi backend.hcl.example)
  backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = local.tags
  }
}

# CloudFront accetta certificati ACM e Web ACL solo in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = local.tags
  }
}

# Regione di disaster recovery: copie dei backup e replica dei documenti (sempre in UE).
provider "aws" {
  alias  = "dr"
  region = var.dr_region

  default_tags {
    tags = local.tags
  }
}
