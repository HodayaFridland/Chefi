# DriveCoach infrastructure (Level 1)
#
# Rewritten from the inherited starter. The original had three serious problems
# that are fixed here (see README "What we changed in the starter kit"):
#   1. The raw bucket was world-readable. It now blocks all public access.
#   2. The Lambda role allowed Action="*" on Resource="*". It is now least-privilege.
#   3. A real API key was committed as a variable default. That is removed; the
#      instructor API is Level 2, so its secret is introduced then.

data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------
# Raw lesson files uploaded by the in-car boxes.
# Private + encrypted: these files are tied to students (personal data).
# ---------------------------------------------------------------
resource "aws_s3_bucket" "raw" {
  bucket_prefix = "${var.project_name}-raw-"
  force_destroy = true # lets `terraform destroy` empty the bucket for this exercise
}

# Block every form of public access. (Fix #1.)
resource "aws_s3_bucket_public_access_block" "raw" {
  bucket                  = aws_s3_bucket.raw.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Encrypt objects at rest with S3-managed keys (SSE-S3). No extra cost.
resource "aws_s3_bucket_server_side_encryption_configuration" "raw" {
  bucket = aws_s3_bucket.raw.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ---------------------------------------------------------------
# DynamoDB: one table holds student state, lesson results and audit records.
# On-demand billing = pay per request = effectively free at this volume.
# ---------------------------------------------------------------
resource "aws_dynamodb_table" "main" {
  name         = "${var.project_name}-data"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  # Encrypt at rest (AWS-owned key, no cost) and allow point-in-time recovery.
  server_side_encryption {
    enabled = true
  }
  point_in_time_recovery {
    enabled = true
  }
}

# ---------------------------------------------------------------
# Rules configuration, stored as a versioned object in S3.
# The Lambda reads the active version (an env var), so moving to v2 later is a
# config change, not a code deploy.
# ---------------------------------------------------------------
resource "aws_s3_object" "rules_v1" {
  bucket       = aws_s3_bucket.raw.id
  key          = "config/rules_v1.json"
  source       = "${path.module}/../sample_data/rules_v1.json"
  etag         = filemd5("${path.module}/../sample_data/rules_v1.json")
  content_type = "application/json"
}

# ---------------------------------------------------------------
# Execution role for the processing Lambda, with least-privilege permissions.
# ---------------------------------------------------------------
resource "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-lambda-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Exactly the permissions the function needs, and nothing more. (Fix #2.)
resource "aws_iam_role_policy" "lambda" {
  name = "${var.project_name}-lambda-policy"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadLessonAndConfigObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.raw.arn}/*"
      },
      {
        Sid    = "ReadWriteTable"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:BatchWriteItem"
        ]
        Resource = aws_dynamodb_table.main.arn
      },
      {
        Sid    = "WriteOwnLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.lambda.arn}:*"
      }
    ]
  })
}

# ---------------------------------------------------------------
# The processing Lambda. The source is zipped by Terraform itself, so there is
# no separate build step. AWS SDK v3 is built into the Node 20 runtime.
# ---------------------------------------------------------------
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../src"
  output_path = "${path.module}/build/process_lesson.zip"
}

# Create the log group ourselves so we control retention (and the IAM policy
# above can scope to it).
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.project_name}-process-lesson"
  retention_in_days = 14
}

resource "aws_lambda_function" "process_lesson" {
  function_name = "${var.project_name}-process-lesson"
  role          = aws_iam_role.lambda_exec.arn
  runtime       = "nodejs20.x"
  handler       = "handlers/processLesson.handler"
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      TABLE_NAME        = aws_dynamodb_table.main.name
      RULES_BUCKET      = aws_s3_bucket.raw.id
      RULES_KEY         = aws_s3_object.rules_v1.key
      ACTIVE_RULES_VERSION = "v1"
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}

# ---------------------------------------------------------------
# Wire S3 object-created events (under incoming/) to the Lambda.
# ---------------------------------------------------------------
resource "aws_lambda_permission" "allow_s3" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.process_lesson.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.raw.arn
}

resource "aws_s3_bucket_notification" "raw" {
  bucket = aws_s3_bucket.raw.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.process_lesson.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "incoming/"
    filter_suffix       = ".csv"
  }

  depends_on = [aws_lambda_permission.allow_s3]
}
