mod orders;
mod sessions;

use redis::Client;

#[tokio::main]
async fn main() -> redis::RedisResult<()> {
    let url = std::env::var("REDIS_URL").expect("REDIS_URL");
    let client = Client::open(url)?;
    let mut con = client.get_multiplexed_async_connection().await?;
    sessions::create_index(&mut con).await?;
    orders::consume(&mut con, "worker-1").await?;
    Ok(())
}
