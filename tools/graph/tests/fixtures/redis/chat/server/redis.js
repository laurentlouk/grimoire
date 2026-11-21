// The chat server's store: one client (node-redis v3, callback style), its commands wrapped as
// promises for the rest of the server.
const { promisify } = require('util')
const util = require('util')
const redis = require('redis')

const client = redis.createClient(process.env.REDIS_URL)
const sub = client.duplicate()

const settle = (resolve, reject) => (err, value) => (err ? reject(err) : resolve(value))

// a method promisified, bound to the client (outside or inside)
const get = promisify(client.get).bind(client)
const hgetall = util.promisify(client.hgetall).bind(client)
const smembers = promisify(client.smembers.bind(client))
// a function passing its parameters on
const sismember = (...args) => client.sismember(...args)
const hset = (key, field, value) => new Promise((resolve, reject) => client.hset(key, field, value, settle(resolve, reject)))

// presence: the wrappers called in this file, and the callback style
const touch = async (userId) => {
  await hset(`presence:${userId}`, 'seen', Date.now())
  client.expire(`presence:${userId}`, 120, (err) => { if (err) console.error(err) })
}
const presence = (userId) => hgetall(`presence:${userId}`)
const leave = (userId, done) => client.del(`presence:${userId}`, done)

module.exports = {
  client,
  sub,
  get,
  hgetall,
  smembers,
  sismember,
  touch,
  presence,
  leave,
  incr: (key) => new Promise((resolve, reject) => client.incr(key, settle(resolve, reject))),
  set: (key = 'key', value) => new Promise((resolve, reject) => client.set(key, value, settle(resolve, reject))),
  exists: (key) => new Promise((resolve, reject) => client.exists(key, settle(resolve, reject))),
  sadd: (key, member) => new Promise((resolve, reject) => client.sadd(key, member, settle(resolve, reject))),
  srem: (key, member) => new Promise((resolve, reject) => client.srem(key, member, settle(resolve, reject))),
  zadd: (key, score, member) => new Promise((resolve, reject) => client.zadd(key, score, member, settle(resolve, reject))),
  hmset: (key, pairs) => new Promise((resolve, reject) => client.hmset(key, pairs, settle(resolve, reject))),
  hmget: (key, field) => new Promise((resolve, reject) => client.hmget(key, field, settle(resolve, reject))),
  // exported, never called: its own command stays, its key a parameter
  decr: (key) => new Promise((resolve, reject) => client.decr(key, settle(resolve, reject))),
  // named after a command, not a wrapper of it: it builds its own key
  del: (id) => client.del(`legacy:${id}`),
}
