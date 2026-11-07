//! Reviews: the repository is given its table; only its test names one.
use crate::model::Review;

pub struct ReviewRepo {
    client: Client,
    table: String,
}

impl ReviewRepo {
    pub fn new(client: Client, table: String) -> Self {
        Self { client, table }
    }

    pub async fn put(&self, review: &Review) -> Result<(), Error> {
        let item = serde_dynamo::to_item(review)?;
        self.client.put_item().table_name(&self.table).set_item(Some(item)).send().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_its_table() {
        let repo = ReviewRepo::new(test_client(), "test-shop-reviews".to_string());
        assert_eq!(repo.table, "test-shop-reviews");
    }
}
