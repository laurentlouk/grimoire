terraform {
  source = "../../modules//shop-tables"
}

# env and project are set by the pipeline, outside the repository: each table's name is a template
inputs = {
  tables = {
    orders      = { hash_key = "customerId", range_key = "orderId" }
    customers   = { hash_key = "id" }
    carts       = { hash_key = "id" }
    saved_carts = { hash_key = "id" }
    reviews     = { hash_key = "sku", range_key = "id" }
  }
}
