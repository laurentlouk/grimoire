import { redis } from './lib/redis'

export function listenOrders(onOrder: (id: string) => void) {
  const sub = redis.duplicate()
  sub.subscribe('orders:events')
  sub.on('message', (_channel, id) => onOrder(id))
}
