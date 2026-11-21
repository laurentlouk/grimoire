import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text('title'),
  body: text('body'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).default(sql`(unixepoch())`).notNull(),
})
