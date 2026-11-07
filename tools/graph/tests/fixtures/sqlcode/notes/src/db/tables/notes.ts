import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core'
import { relations, sql } from 'drizzle-orm'
import { people } from './people'

export const notes = sqliteTable(
  'notes',
  {
    id: text().primaryKey().$defaultFn(() => crypto.randomUUID()),
    authorId: integer().notNull().references(() => people.id, { onDelete: 'cascade' }),
    body: text().notNull(),
    pinned: integer({ mode: 'boolean' }).notNull().default(false),
    status: text({ enum: ['draft', 'shared'] }).notNull().default('draft'),
    wordCount: integer().default(sql`(0)`),
  },
  (t) => [index('notes_author_idx').on(t.authorId, t.pinned)],
)

export const noteLinks = sqliteTable(
  'note_links',
  {
    fromId: text().notNull().references(() => notes.id),
    toId: text().notNull().references(() => notes.id),
  },
  (t) => [primaryKey({ columns: [t.fromId, t.toId] })],
)

export const notesRelations = relations(notes, ({ one }) => ({ author: one(people, { fields: [notes.authorId], references: [people.id] }) }))
