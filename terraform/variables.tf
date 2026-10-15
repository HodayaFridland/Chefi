variable "region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "owner" {
  description = "Your name, used for tagging"
  type        = string
  default     = "candidate"
}

variable "project_name" {
  description = "Prefix for resource names"
  type        = string
  default     = "drivecoach"
}

# NOTE: the inherited starter committed a real-looking `instructor_api_key`
# default here, which is a secret-in-the-repo problem. It has been removed.
# The instructor read API is Level 2; its secret will be introduced then,
# supplied at deploy time (never committed) and stored as an SSM SecureString.
