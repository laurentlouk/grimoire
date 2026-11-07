# The shop's key-value tables, one per entry of var.tables, and the function that reads two of them.
resource "aws_dynamodb_table" "this" {
  for_each = var.tables

  name         = "${var.env}-${var.project}-${each.key}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = each.value.hash_key
  range_key    = try(each.value.range_key, null)

  attribute {
    name = each.value.hash_key
    type = "S"
  }

  dynamic "attribute" {
    for_each = try(each.value.range_key, null) != null ? [each.value.range_key] : []
    content {
      name = attribute.value
      type = "S"
    }
  }
}

resource "aws_lambda_function" "api" {
  function_name = "${var.env}-${var.project}-api"
  handler       = "bootstrap"
  runtime       = "provided.al2023"

  environment {
    variables = {
      ORDERS_TABLE    = aws_dynamodb_table.this["orders"].name
      CUSTOMERS_TABLE = aws_dynamodb_table.this["customers"].name
      LOG_LEVEL       = "info"
    }
  }
}
