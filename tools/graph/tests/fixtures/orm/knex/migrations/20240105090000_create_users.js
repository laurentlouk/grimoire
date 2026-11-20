exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL DEFAULT 'free'
    )
  `)
  await knex.raw('CREATE INDEX users_plan ON users (plan)')
}

exports.down = async function (knex) {
  await knex.raw('DROP TABLE users')
}
