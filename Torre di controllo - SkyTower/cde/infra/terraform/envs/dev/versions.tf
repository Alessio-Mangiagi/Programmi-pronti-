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

  # Stato remoto: bucket e tabella di lock creati una tantum (bootstrap) fuori da questo stack.
  # backend "s3" {
  #   bucket         = "cde-terraform-state"
  #   key            = "envs/dev/terraform.tfstate"
  #   region         = "eu-south-1"
  #   dynamodb_table = "cde-terraform-lock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "cde-iso19650"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
