terraform {
  source = "git::https://example.com/org/modules.git//search?ref=v1.2.0"
}

include "root" {
  path = find_in_parent_folders("root.hcl")
}
