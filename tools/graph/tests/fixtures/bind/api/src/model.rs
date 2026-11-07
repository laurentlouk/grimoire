//! The shop's items, as the API stores them.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    pub customer_id: String,
    pub order_id: String,
    pub status: OrderStatus,
    #[serde(rename = "total")]
    pub total_cents: u64,
    pub note: Option<String>,
    pub lines: Vec<LineItem>,
    pub coupons: HashMap<String, u32>,
    #[serde(flatten)]
    pub audit: Audit,
    #[serde(default)]
    pub gift: bool,
    #[serde(skip)]
    pub cached_total: Option<u64>,
    pub payment: Payment,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OrderStatus {
    Open,
    Paid,
    OnHold,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineItem {
    pub sku: String,
    pub qty: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Audit {
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "method", content = "details", rename_all = "kebab-case")]
pub enum Payment {
    Card { last4: String },
    GiftCard { code: String },
    Invoice,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Customer {
    pub id: String,
    pub email: String,
    #[serde(rename = "displayName")]
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cart {
    pub id: String,
    pub items: Vec<LineItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Review {
    pub sku: String,
    pub id: String,
    pub stars: u8,
}

/// A coupon converts itself to an item, but no code says which table holds it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Coupon {
    pub code: String,
    pub percent: u8,
}

impl Coupon {
    pub fn to_dynamo_item(&self) -> HashMap<String, AttributeValue> {
        serde_dynamo::to_item(self).unwrap_or_default()
    }
}
