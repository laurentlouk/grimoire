locals {
  region = "eu-west-1"
}

remote_state {
  backend = "s3"
  config = {
    bucket = "shop-state"
    key    = "${path_relative_to_include()}/terraform.tfstate"
    region = local.region
  }
}

inputs = {
  app = "shop"
}
