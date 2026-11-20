const { incr, set, hmset, sadd, hmget, client: redisClient } = require('./redis')

/** the key a user name is looked up by */
const usernameKey = (name) => {
  const key = `username:${name}`
  return key
}

const createUser = async (name, hash) => {
  const key = usernameKey(name)
  const id = await incr('total_users')
  const userKey = `user:${id}`
  await set(key, userKey)
  await hmset(userKey, ['username', name, 'password', hash])
  await sadd(`user:${id}:rooms`, '0')
  return { id, name }
}

const roomNames = async (a, b) => [await hmget(`user:${a}`, 'username'), await hmget(`user:${b}`, 'username')]

const messages = (roomId, offset, size) => new Promise((resolve, reject) => {
  redisClient.zrevrange(`room:${roomId}`, offset, offset + size, (err, values) => (err ? reject(err) : resolve(values)))
})

module.exports = { usernameKey, createUser, roomNames, messages }
