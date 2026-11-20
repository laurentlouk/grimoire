/** @param { import("knex").Knex } knex */
export async function up(knex) {
  await knex.schema.raw(
    'CREATE TABLE orders (' +
      'id INTEGER PRIMARY KEY, ' +
      'user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, ' +
      'total INTEGER' +
    ')',
  )
  await knex.schema.createTable('audit', (t) => { t.increments('id') })
}

export async function down(knex) {
  await knex.schema.dropTable('orders')
}
