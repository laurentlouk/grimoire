//! Orders, in the table the infra names `{env}-{project}-orders`.
use crate::model::Order;

pub async fn put_order(client: &Client, stage: &str, order: &Order) -> Result<(), Error> {
    let item = serde_dynamo::to_item(order)?;
    client
        .put_item()
        .table_name(format!("{}-shop-orders", stage))
        .set_item(Some(item))
        .send()
        .await?;
    Ok(())
}

pub async fn get_order(client: &Client, stage: &str, key: HashMap<String, AttributeValue>) -> Result<Option<Order>, Error> {
    let out = client.get_item().table_name(format!("{}-shop-orders", stage)).set_key(Some(key)).send().await?;
    Ok(out.item.map(|item| serde_dynamo::from_item(item)).transpose()?)
}
