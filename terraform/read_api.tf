# ---------------------------------------------------------------
# LEVEL 2 — instructor read API
#
# A second Lambda behind a public Lambda Function URL (no API Gateway needed):
#   GET /students/{id}?key=...   GET /lessons/{id}?key=...
# Authenticated with a shared key (generated here, never committed) passed as
# ?key=... and checked inside the handler. Kept in its own file so Level 1 and
# Level 2 stay clearly separated.
# ---------------------------------------------------------------

# A generated instructor key, so no secret lives in the repo. It is surfaced via
# a sensitive output after `terraform apply`.
resource "random_password" "instructor_api_key" {
  length  = 20
  special = false
}

# Least-privilege role: this function only reads the table.
resource "aws_iam_role" "read_exec" {
  name = "${var.project_name}-read-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_cloudwatch_log_group" "read" {
  name              = "/aws/lambda/${var.project_name}-read-api"
  retention_in_days = 14
}

resource "aws_iam_role_policy" "read" {
  name = "${var.project_name}-read-policy"
  role = aws_iam_role.read_exec.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadTable"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"]
        Resource = aws_dynamodb_table.main.arn
      },
      {
        Sid      = "WriteOwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.read.arn}:*"
      }
    ]
  })
}

# Reuses the same source archive as the processing Lambda (it contains both
# handlers); only the handler entry point differs.
resource "aws_lambda_function" "read_api" {
  function_name = "${var.project_name}-read-api"
  role          = aws_iam_role.read_exec.arn
  runtime       = "nodejs20.x"
  handler       = "handlers/readApi.handler"
  timeout       = 15
  memory_size   = 128

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.main.name
      API_KEY    = random_password.instructor_api_key.result
    }
  }

  depends_on = [aws_cloudwatch_log_group.read]
}

# Public HTTPS endpoint for the function. Auth is handled in code (the key),
# so the URL itself is open (NONE) and reachable from a browser.
resource "aws_lambda_function_url" "read_api" {
  function_name      = aws_lambda_function.read_api.function_name
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "read_api_url" {
  statement_id           = "FunctionURLAllowPublicAccess"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.read_api.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

output "read_api_url" {
  description = "Instructor read API base URL"
  value       = aws_lambda_function_url.read_api.function_url
}

output "instructor_api_key" {
  description = "Key to pass as ?key=... on the read API"
  value       = random_password.instructor_api_key.result
  sensitive   = true
}
