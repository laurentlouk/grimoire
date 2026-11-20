// in-process preferences: no store
const prefs = new Map()

module.exports = { set: (name, value) => prefs.set(name, value) }
