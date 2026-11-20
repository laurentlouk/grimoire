const { client: redisClient, sub, exists, set, get, hgetall, sadd, srem, smembers, sismember, del: forget, touch } = require('./redis')
const { set: remember } = require('./settings')
const { createUser, usernameKey } = require('./users')

const publish = (type, data) => redisClient.publish('MESSAGES', JSON.stringify({ type, data }))

const boot = async () => {
  if (!(await exists('total_users'))) {
    await set('total_users', 0)
    await set(`room:${0}:name`, 'General')
  }
  sub.subscribe('MESSAGES')
}

const login = async (name, hash) => {
  const key = usernameKey(name)
  if (!(await exists(key))) return createUser(name, hash)
  const userKey = await get(key)
  return hgetall(userKey)
}

const online = async () => {
  const ids = await smembers('online_users')
  return Promise.all(ids.map((id) => hgetall(`user:${id}`)))
}

const connect = async (userId) => {
  await sadd('online_users', userId)
  await touch(userId)
  publish('user.connected', { id: userId })
}

const isOnline = async (userId) => !!(await sismember('online_users', userId))

const disconnect = async (userId) => {
  await srem('online_users', userId)
  forget(userId)
}

const rooms = async (userId) => {
  const ids = await smembers(`user:${userId}:rooms`)
  const out = []
  for (const roomId of ids) out.push({ id: roomId, name: await get(`room:${roomId}:name`) })
  return out
}

const preferences = () => remember('theme', 'dark')

module.exports = { boot, login, online, connect, isOnline, disconnect, rooms, preferences }
