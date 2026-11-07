# The production tables. env and project come from the pipeline: each name is a template.
resource "aws_dynamodb_table" "event" {
  name         = "${var.env}-${var.project}-event"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "eventId"

  attribute {
    name = "eventId"
    type = "S"
  }

  attribute {
    name = "ownerId"
    type = "S"
  }

  global_secondary_index {
    name            = "ByOwner"
    hash_key        = "ownerId"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "order" {
  name         = "${var.env}-${var.project}-order"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "orderId"

  attribute {
    name = "orderId"
    type = "S"
  }
}
