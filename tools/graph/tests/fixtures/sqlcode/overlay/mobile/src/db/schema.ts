// The schema behind fixtures/data/mobile's migrations and snapshots (its drizzle.config.ts names this
// file): copied over that fixture by the test, then edited without generating a migration.
import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const authors = sqliteTable('authors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  bio: text('bio').notNull().default(''),
})

export const books = sqliteTable(
  'books',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    authorId: integer('author_id').notNull().references(() => authors.id, { onDelete: 'cascade' }),
    publishedAt: integer('published_at', { mode: 'timestamp' }),
    isbn: text('isbn').unique(),
  },
  (t) => [index('books_author_idx').on(t.authorId)],
)

export const shelves = sqliteTable('shelves', {
  id: text('id').primaryKey(),
  label: text('label').notNull().default('unsorted'),
})

export const shelfBooks = sqliteTable(
  'shelf_books',
  {
    shelfId: text('shelf_id').notNull().references(() => shelves.id, { onDelete: 'cascade' }),
    bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.shelfId, t.bookId] })],
)

export const streaks = sqliteTable('streaks', {
  day: text('day').primaryKey(),
  pages: integer('pages').notNull().default(0),
  loggedAt: integer('logged_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})
