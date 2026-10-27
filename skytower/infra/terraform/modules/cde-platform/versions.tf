# "><(((º> sabusabu <º)))><"
terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.80"
      configuration_aliases = [aws.us_east_1, aws.dr]
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
