//! A cart saved for later moves from one table to another: one function names both.
use crate::model::Cart;

pub async fn save_for_later(client: &Client, stage: &str, cart: Cart) -> Result<(), Error> {
    let item = serde_dynamo::to_item(&cart)?;
    client.put_item().table_name(format!("{stage}-shop-saved_carts")).set_item(Some(item.clone())).send().await?;
    client.delete_item().table_name(format!("{stage}-shop-carts")).set_key(Some(item)).send().await?;
    Ok(())
}
