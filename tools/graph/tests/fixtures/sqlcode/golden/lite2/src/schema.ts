// Synthetic. drizzle/ beside it was generated from this file by drizzle-kit 0.31 (stable): a golden expectation.
import { sqliteTable, integer, text, real, index, uniqueIndex, primaryKey, unique } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

const timestamps = {
  createdAt: integer({ mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}
export const users = sqliteTable('users', {
  id: integer().primaryKey({ autoIncrement: true }),
  displayName: text().notNull(),
  email: text().notNull(),
  rate: real().default(1.0),
  rate2: real().default(0.50),
  rate3: real().default(1e3),
  rate4: integer().default(1_000),
  ...timestamps,
}, (t) => [
  uniqueIndex('users_email_lower').on(sql`lower(${t.email})`),
  unique().on(t.displayName, t.email),
  unique('named_u').on(t.displayName),
])
export const tags = sqliteTable('tags', {
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  tag: text().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.tag] }) }))
