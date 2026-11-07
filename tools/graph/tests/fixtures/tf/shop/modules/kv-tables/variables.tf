variable "stage" {
  type = string
}

variable "app" {
  type    = string
  default = "app"
}

# a credential the module tags its tables with: set by terraform.tfvars, never part of the model
variable "api_token" {
  type    = string
  default = ""
}

variable "tables" {
  description = <<-EOT
    The tables, by name. Each one:
      hash_key, range_key   its keys
      indexes               its GSIs
      ttl, stream           on by default
  EOT
  type = map(object({
    hash_key  = string
    range_key = optional(string)
    ttl       = optional(bool, true)
    stream    = optional(bool, false)
    types     = optional(map(string), {})
    indexes = list(object({
      name       = string
      hash_key   = string
      range_key  = optional(string)
      projection = string
    }))
  }))
}
