//! A library catalogue's books, as the service stores them.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub shelf_id: String,
    pub book_id: String,
    pub author_id: String,
    pub isbn: String,
    pub genre: String,
    pub status: String,
    pub title: String,
    pub copies: u32,
}
