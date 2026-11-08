use redis::aio::MultiplexedConnection;
use redis::AsyncCommands;

const RATE_SCRIPT: &str = r#"
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], 60) end
return n
"#;

pub async fn save_session(con: &mut MultiplexedConnection, user_id: &str, token: &str) -> redis::RedisResult<()> {
    let key = format!("user:{}:session", user_id);
    let _: () = con.hset_multiple(&key, &[("token", token), ("device", "web")]).await?;
    let _: () = con.expire(&key, 1800).await?;
    Ok(())
}

pub async fn save_profile(con: &mut MultiplexedConnection, user_id: &str, name: &str) -> redis::RedisResult<()> {
    let _: () = con.hset(format!("user:{user_id}:profile"), "name", name).await?;
    Ok(())
}

pub async fn add_to_cart(con: &mut MultiplexedConnection, cart_id: &str, sku: &str) -> redis::RedisResult<()> {
    let _: () = con.hincr(format!("cart:{}", cart_id), sku, 1).await?;
    Ok(())
}

pub async fn allow(con: &mut MultiplexedConnection, ip: &str) -> redis::RedisResult<bool> {
    let n: i64 = redis::Script::new(RATE_SCRIPT).key(format!("rate:{}", ip)).invoke_async(con).await?;
    Ok(n <= 100)
}

pub async fn create_index(con: &mut MultiplexedConnection) -> redis::RedisResult<()> {
    redis::cmd("FT.CREATE").arg("idx:users").arg("ON").arg("HASH").arg("PREFIX").arg(1).arg("user:")
        .arg("SCHEMA").arg("name").arg("TEXT").arg("SORTABLE").arg("email").arg("TAG")
        .query_async::<()>(con).await
}
