import { redis } from './lib/redis'

const CART_TTL = 3600

export async function saveCart(cartId: string, items: string[]): Promise<void> {
  await redis.set(`cart:${cartId}`, JSON.stringify(items), 'EX', CART_TTL)
}

export async function readSession(userId: string) {
  return redis.hgetall(`user:${userId}:session`)
}
