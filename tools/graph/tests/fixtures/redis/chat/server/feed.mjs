import { zadd, get as read } from './redis.js'

export async function post(roomId, message) {
  await zadd(`room:${roomId}`, message.date, JSON.stringify(message))
}

export const title = (roomId) => read(`room:${roomId}:name`)
