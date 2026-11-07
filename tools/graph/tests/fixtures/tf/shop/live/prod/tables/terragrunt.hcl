terraform {
  source = "../../../modules//kv-tables"
}

include "root" {
  path = find_in_parent_folders("root.hcl")
}

include "stage" {
  path           = find_in_parent_folders("stage.hcl")
  expose         = true
  merge_strategy = "no_merge"
}

dependency "search" {
  config_path = "../search"
}

inputs = {
  stage = include.stage.locals.stage
  tables = {
    "orders" = {
      hash_key  = "customer_id"
      range_key = "order_id"
      stream    = true
      types     = { placed_at = "N" }
      indexes = [
        {
          name       = "ByStatus"
          hash_key   = "status"
          range_key  = "placed_at"
          projection = "KEYS_ONLY"
        },
      ]
    },
    "carts" = {
      hash_key = "id"
      ttl      = false
      indexes  = []
    },
    # its sort key comes from another configuration: unknown here
    "audit" = {
      hash_key  = "id"
      range_key = dependency.search.outputs.sort_attr
      indexes = [
        { name = "ByActor", hash_key = "actor_id", projection = "ALL" },
      ]
    },
  }
}
