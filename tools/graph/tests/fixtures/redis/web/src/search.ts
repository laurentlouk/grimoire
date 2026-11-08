import { redis } from './lib/redis'

export async function searchUsers(q: string) {
  return redis.call('FT.SEARCH', 'idx:users', q)
}

export async function createProductIndex() {
  await redis.call('FT.CREATE', 'idx:products', 'ON', 'JSON', 'PREFIX', '1', 'product:', 'SCHEMA', '$.title', 'AS', 'title', 'TEXT', '$.price', 'AS', 'price', 'NUMERIC')
}

export async function saveProduct(id: string, doc: object) {
  await redis.call('JSON.SET', `product:${id}`, '$', JSON.stringify(doc))
}
