// A key-value table per entry of var.tables: the keys, the GSIs and the TTL come from each entry.
resource "aws_dynamodb_table" "table" {
  for_each = var.tables

  name         = "${var.stage}-${var.app}-${each.key}"
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

  dynamic "attribute" {
    for_each = toset(flatten([
      for gsi in each.value.indexes : compact([gsi.hash_key, try(gsi.range_key, null)])
    ]))
    iterator = key
    content {
      name = key.value
      type = lookup(each.value.types, key.value, "S")
    }
  }

  dynamic "global_secondary_index" {
    for_each = each.value.indexes
    content {
      name            = global_secondary_index.value.name
      hash_key        = global_secondary_index.value.hash_key
      range_key       = try(global_secondary_index.value.range_key, null)
      projection_type = global_secondary_index.value.projection
    }
  }

  /* expiry: the block is always there, on or off */
  ttl {
    attribute_name = each.value.ttl ? "expires_at" : ""
    enabled        = each.value.ttl
  }

  stream_enabled   = each.value.stream
  stream_view_type = each.value.stream ? "NEW_AND_OLD_IMAGES" : null

  tags = {
    Name  = "${var.app}-${each.key}"
    Token = var.api_token
  }
}
