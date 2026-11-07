//! Creates the books table where none exists (local runs): its declaration in code, never a query.
use aws_sdk_dynamodb::types::{GlobalSecondaryIndex, KeySchemaElement, Projection};

pub async fn ensure_table(client: &Client, stage: &str) -> Result<(), Error> {
    client
        .create_table()
        .table_name(format!("{}-catalog-books", stage))
        .global_secondary_indexes(
            GlobalSecondaryIndex::builder()
                .index_name("ByStatus")
                .key_schema(KeySchemaElement::builder().attribute_name("status").build()?)
                .projection(Projection::builder().build())
                .build()?,
        )
        .send()
        .await?;
    Ok(())
}
