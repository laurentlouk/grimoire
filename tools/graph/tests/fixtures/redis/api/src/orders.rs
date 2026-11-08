use redis::aio::MultiplexedConnection;
use redis::streams::{StreamReadOptions, StreamReadReply};
use redis::AsyncCommands;

pub async fn publish_order(con: &mut MultiplexedConnection, order_id: &str) -> redis::RedisResult<()> {
    let _: () = con.xadd("stream:orders", "*", &[("kind", "created"), ("order_id", order_id)]).await?;
    let _: () = con.publish("orders:events", order_id).await?;
    Ok(())
}

pub async fn consume(con: &mut MultiplexedConnection, worker: &str) -> redis::RedisResult<()> {
    let _: () = con.xgroup_create_mkstream("stream:orders", "billing", "$").await?;
    let opts = StreamReadOptions::default().group("billing", worker).count(10);
    let reply: StreamReadReply = con.xread_options(&["stream:orders"], &[">"], &opts).await?;
    for key in reply.keys {
        for id in key.ids {
            let _: () = con.xack("stream:orders", "billing", &[id.id]).await?;
        }
    }
    Ok(())
}
