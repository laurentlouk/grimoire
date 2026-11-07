terraform {
  source = "tfr:///terraform-aws-modules/dynamodb-table/aws?version=4.0.0"
}

inputs = {
  name     = "legacy-sessions"
  hash_key = "id"
}
