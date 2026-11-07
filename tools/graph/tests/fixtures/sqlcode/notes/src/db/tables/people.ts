import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const timestamps = {
  createdAt: integer({ mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer({ mode: 'timestamp' }).$onUpdate(() => new Date()),
}

export const people = sqliteTable('people', {
  id: integer().primaryKey({ autoIncrement: true }),
  handle: text().notNull().unique(),
  displayName: text('name'),
  ...timestamps,
})
