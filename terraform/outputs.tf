output "raw_bucket" {
  description = "S3 bucket where lesson files are uploaded (prefix: incoming/)"
  value       = aws_s3_bucket.raw.bucket
}

output "table_name" {
  description = "DynamoDB table holding student state, lessons and audit records"
  value       = aws_dynamodb_table.main.name
}

output "lambda_function_name" {
  description = "The lesson-processing Lambda"
  value       = aws_lambda_function.process_lesson.function_name
}

output "lambda_role_arn" {
  value = aws_iam_role.lambda_exec.arn
}

output "account_id" {
  value = data.aws_caller_identity.current.account_id
}
