//! Customers, in the table the deployment names in CUSTOMERS_TABLE.
use crate::model::Customer;

pub async fn load_customer(client: &Client, key: HashMap<String, AttributeValue>) -> Result<Customer, Error> {
    let table = std::env::var("CUSTOMERS_TABLE")?;
    let out = client.get_item().table_name(table).set_key(Some(key)).send().await?;
    let customer: Customer = serde_dynamo::from_item(out.item.unwrap_or_default())?;
    Ok(customer)
}
