//! Books, in the table named `<stage>-catalog-books`.
use crate::indexes::BY_ISBN;
use crate::model::Book;

pub async fn save(client: &Client, stage: &str, book: &Book) -> Result<(), Error> {
    let item = serde_dynamo::to_item(book)?;
    client
        .put_item()
        .table_name(format!("{}-catalog-books", stage))
        .set_item(Some(item))
        .send()
        .await?;
    Ok(())
}

pub async fn by_author(client: &Client, stage: &str, author: &str) -> Result<Vec<Book>, Error> {
    let out = client
        .query()
        .table_name(format!("{}-catalog-books", stage))
        .index_name("ByAuthor")
        .key_condition_expression("authorId = :a")
        .expression_attribute_values(":a", AttributeValue::S(author.into()))
        .send()
        .await?;
    Ok(serde_dynamo::from_items(out.items.unwrap_or_default())?)
}

pub async fn by_isbn(client: &Client, stage: &str, isbn: &str) -> Result<Vec<Book>, Error> {
    let out = client
        .query()
        .table_name(format!("{}-catalog-books", stage))
        .index_name(BY_ISBN)
        .key_condition_expression("isbn = :i")
        .send()
        .await?;
    Ok(serde_dynamo::from_items(out.items.unwrap_or_default())?)
}

pub async fn shelve(client: &Client, stage: &str, key: HashMap<String, AttributeValue>) -> Result<(), Error> {
    client
        .update_item()
        .table_name(format!("{}-catalog-books", stage))
        .set_key(Some(key))
        .update_expression("SET #s = :s, shelvedAt = :t")
        .expression_attribute_names("#s", "status")
        .send()
        .await?;
    Ok(())
}

pub async fn remove(client: &Client, stage: &str, key: HashMap<String, AttributeValue>) -> Result<(), Error> {
    client.delete_item().table_name(format!("{}-catalog-books", stage)).set_key(Some(key)).send().await?;
    Ok(())
}
