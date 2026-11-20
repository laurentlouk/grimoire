import { redis } from './lib/redis'

export async function saveCartCache(cartId: string, items: string[]): Promise<void> {
  await redis.set(`cart:${cartId}`, JSON.stringify(items), 'EX', 600)
}

export async function readSession(userId: string) {
  return redis.hgetall(`user:${userId}:session`)
}

export async function saveProduct(productId: string, doc: object) {
  await redis.call('JSON.SET', `product:${productId}`, '$', JSON.stringify(doc))
}

export async function createProductIndex() {
  await redis.call('FT.CREATE', 'idx:products', 'ON', 'JSON', 'PREFIX', '1', 'product:', 'SCHEMA', '$.title', 'AS', 'title', 'TEXT')
}
