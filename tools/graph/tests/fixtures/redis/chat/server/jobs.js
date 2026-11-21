const store = require('./redis')

const nightly = async () => {
  await store.incr('jobs:nightly:runs')
  return store.hgetall('jobs:nightly')
}

module.exports = { nightly }
