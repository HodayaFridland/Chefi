terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "aws" {
  region = var.region

  # Use path-style S3 URLs when set. Virtual-hosted style (the default) relies on
  # per-bucket subdomains, which some network proxies block; path-style keeps all
  # calls on the base S3 endpoint. Off by default; harmless when deploying normally.
  s3_use_path_style = var.s3_use_path_style

  default_tags {
    tags = {
      Project = "drivecoach"
      Owner   = var.owner
    }
  }
}
